package com.almadinaexpress.app.network

import android.content.Context
import android.util.Log
import com.almadinaexpress.app.BuildConfig
import com.almadinaexpress.app.security.SecureStore
import com.almadinaexpress.app.security.SessionBoundary
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit

class ApiException(
    override val message: String,
    val status: Int,
    val payload: JsonObject? = null,
) : IOException(message)

/** Load the shared encrypted jar each time, including in WorkManager. */
class PersistentCookieJar(private val store: SecureStore) {
    private val base = BuildConfig.API_BASE_URL.toHttpUrl()
    private val allowed = setOf("almadina_session", "almadina_passkey_login", "almadina_password_reset", "almadina_registration")

    private fun saved(): List<Cookie> = store.get(SecureStore.KEY_COOKIES)?.lineSequence()
        ?.mapNotNull { Cookie.parse(base, it) }
        ?.filter { it.name in allowed && it.domain == base.host && it.expiresAt > System.currentTimeMillis() && it.value.isNotEmpty() }
        ?.toList().orEmpty()

    fun loadForRequest(url: HttpUrl, epoch: Long): List<Cookie> = SessionBoundary.withCurrent(epoch) {
        saved().filter { it.matches(url) }
    }

    fun saveFromResponse(url: HttpUrl, incoming: List<Cookie>, epoch: Long) = SessionBoundary.withCurrent(epoch) {
        if (incoming.isNotEmpty()) {
            val cookies = saved().toMutableList()
            for (cookie in incoming.filter { it.name in allowed && it.domain == base.host && it.matches(url) }) {
                cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
                if (cookie.expiresAt > System.currentTimeMillis() && cookie.value.isNotEmpty()) cookies.add(cookie)
            }
            val value = cookies.joinToString("\n") { it.toString() }
            if (value.isEmpty()) store.remove(SecureStore.KEY_COOKIES)
            else store.put(SecureStore.KEY_COOKIES, value)
        }
    }

    fun clear() = store.remove(SecureStore.KEY_COOKIES)
}

class ApiClient(context: Context, secureStore: SecureStore) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = false }
    private val cookieJar = PersistentCookieJar(secureStore)
    private val base = BuildConfig.API_BASE_URL.toHttpUrl()
    private val client = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(35, TimeUnit.SECONDS)
        .callTimeout(50, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    init {
        // Earlier releases configured an unencrypted disk HTTP cache. Account
        // snapshots continue to use the encrypted offline store instead.
        runCatching { File(context.cacheDir, "network-v2").deleteRecursively() }
    }

    suspend fun get(path: String): JsonObject = execute(path, "GET", null)
    suspend fun post(path: String, body: JsonObject = buildJsonObject { }): JsonObject = execute(path, "POST", body)
    suspend fun put(path: String, body: JsonObject): JsonObject = execute(path, "PUT", body)

    suspend fun execute(path: String, method: String, body: JsonObject?): JsonObject {
        val epoch = SessionBoundary.current()
        val url = base.resolve(path)
        require(base.isHttps && base.username.isEmpty() && base.password.isEmpty() && base.fragment == null &&
            !path.startsWith("/") && !path.contains("\\") && !path.contains("://") && !path.contains("..") &&
            url != null && url.isHttps && url.host == base.host && url.port == base.port && url.fragment == null &&
            url.encodedPath.startsWith(base.encodedPath) &&
            url.pathSegments.none { it == "." || it == ".." || it.contains('/') || it.contains('\\') }) {
            "إعداد عنوان الخادم غير صالح."
        }
        val requestBuilder = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
            .header("X-Almadina-Client", "android-native/${BuildConfig.VERSION_NAME}")
        val cookies = cookieJar.loadForRequest(url, epoch)
        if (cookies.isNotEmpty()) requestBuilder.header("Cookie", cookies.joinToString("; ") { "${it.name}=${it.value}" })
        val requestBody = body?.toString()?.toRequestBody(jsonMedia)
        when (method) {
            "GET" -> requestBuilder.get()
            "POST" -> requestBuilder.post(requestBody ?: "{}".toRequestBody(jsonMedia))
            "PUT" -> requestBuilder.put(requestBody ?: "{}".toRequestBody(jsonMedia))
            else -> error("Unsupported HTTP method")
        }
        val call = client.newCall(requestBuilder.build())
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(error))
                }
                override fun onResponse(call: Call, response: Response) {
                    if (!continuation.isActive) { response.close(); return }
                    try {
                        val payload = response.use {
                            val text = it.body?.string().orEmpty()
                            if (!continuation.isActive) throw CancellationException()
                            SessionBoundary.withCurrent(epoch) {
                                // Optional persistence must not turn a committed
                                // server operation into a reported failure.
                                runCatching { cookieJar.saveFromResponse(url, Cookie.parseAll(url, it.headers), epoch) }
                            }
                            val parsed = runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse { _ ->
                                throw ApiException("استجابة الخادم غير مكتملة. حدّث البيانات قبل إعادة المحاولة.", it.code)
                            }
                            if (!it.isSuccessful) {
                                val requestId = it.header("X-Request-ID").orEmpty().takeIf { value -> Regex("^[a-fA-F0-9-]{36}$").matches(value) }.orEmpty()
                                Log.w("AlmadinaNetwork", "request_failed status=${it.code} requestId=$requestId")
                                val message = (parsed["error"] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
                                    ?: "تعذّر الاتصال بخادم المدينة إكسبرس."
                                throw ApiException(message, it.code, parsed)
                            }
                            SessionBoundary.withCurrent(epoch) { parsed }
                        }
                        continuation.resumeWith(Result.success(payload))
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWith(Result.failure(error))
                    }
                }
            })
        }
    }

    fun clearSession() = cookieJar.clear()
}
