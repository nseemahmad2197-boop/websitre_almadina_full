package com.almadinaexpress.app.data

import android.content.Context
import com.almadinaexpress.app.network.ApiClient
import com.almadinaexpress.app.network.ApiException
import com.almadinaexpress.app.security.SecureStore
import com.almadinaexpress.app.security.SessionBoundary
import com.almadinaexpress.app.security.acceptsSnapshot
import com.almadinaexpress.app.security.BiometricVault
import javax.crypto.Cipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.intOrNull
import java.net.URLEncoder
import java.util.concurrent.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.UUID

class AppRepository(context: Context) {
    private val applicationContext = context.applicationContext
    private val secureStore = SecureStore(context)
    private val api = ApiClient(context, secureStore)
    private val biometricVault = BiometricVault(secureStore)
    private val json = Json { ignoreUnknownKeys = true }

    fun cachedSnapshot(): SessionSnapshot? = secureStore.get(SecureStore.KEY_SNAPSHOT)?.let(::decodeSnapshot)

    suspend fun session(): SessionSnapshot = requestSnapshot { api.get("session") }

    suspend fun login(email: String, password: String): SessionSnapshot {
        clearLocalSession()
        return requestSnapshot { api.post("login", buildJsonObject {
            put("email", email.trim())
            put("password", password)
        }) }
    }

    fun biometricLoginAvailable(): Boolean =
        secureStore.get(SecureStore.KEY_BIOMETRIC_ENABLED) == "true" &&
            !secureStore.get(SecureStore.KEY_BIOMETRIC_EMAIL).isNullOrBlank() &&
            (!secureStore.get(SecureStore.KEY_BIOMETRIC_SECRET).isNullOrBlank() || !secureStore.get(SecureStore.KEY_BIOMETRIC_PASSWORD).isNullOrBlank())

    fun biometricAccountEmail(): String? =
        secureStore.get(SecureStore.KEY_BIOMETRIC_EMAIL)?.takeIf { biometricLoginAvailable() }

    fun availableAccounts(): List<AvailableAccount> {
        val saved = secureStore.get(SecureStore.KEY_AVAILABLE_ACCOUNTS)
            ?.let(::decodeAvailableAccounts)
            .orEmpty()
        val biometricEmail = biometricAccountEmail()
        if (biometricEmail.isNullOrBlank() || saved.any { it.email.equals(biometricEmail, ignoreCase = true) }) {
            return saved
        }
        return listOf(
            AvailableAccount(
                id = "biometric",
                email = biometricEmail,
                name = "حساب البصمة المحفوظ",
                description = "الدخول بالبصمة مفعّل على هذا الجهاز",
            ),
        ) + saved
    }

    fun rememberAccount(user: UserItem): List<AvailableAccount> {
        val current = availableAccounts().filterNot { it.id == "biometric" }
        val account = AvailableAccount(
            id = user.id,
            email = user.email,
            name = user.name.ifBlank { user.store.ifBlank { "حساب محفوظ" } },
            description = user.store.ifBlank {
                when (user.role) {
                    Role.ADMIN -> "حساب الإدارة"
                    Role.COURIER -> "مندوب / موظف"
                    Role.MERCHANT -> user.membership.arabic
                }
            },
        )
        val next = (listOf(account) + current.filterNot {
            it.id == account.id || it.email.equals(account.email, ignoreCase = true)
        }).take(MAX_AVAILABLE_ACCOUNTS)
        if (next != current) saveAvailableAccounts(next)
        return next
    }

    fun forgetAvailableAccount(userId: String, email: String) {
        val next = availableAccounts().filterNot {
            it.id == userId || it.email.equals(email, ignoreCase = true)
        }
        saveAvailableAccounts(next)
    }

    fun prepareBiometricCipher(enrolling: Boolean): Cipher = biometricVault.prepare(enrolling)

    suspend fun enableBiometricLogin(email: String, password: String, cipher: Cipher): SessionSnapshot {
        val verifiedSnapshot = login(email, password)
        secureStore.put(SecureStore.KEY_BIOMETRIC_EMAIL, email.trim().lowercase())
        biometricVault.save(password, cipher)
        secureStore.put(SecureStore.KEY_BIOMETRIC_ENABLED, "true")
        return verifiedSnapshot
    }

    suspend fun loginWithBiometrics(cipher: Cipher): SessionSnapshot {
        val email = secureStore.get(SecureStore.KEY_BIOMETRIC_EMAIL)
        val password = biometricVault.read(cipher)
        require(biometricLoginAvailable() && !email.isNullOrBlank() && !password.isNullOrBlank()) {
            "لم يتم تفعيل الدخول بالبصمة لهذا الجهاز."
        }
        return login(email, password)
    }

    fun disableBiometricLogin() = biometricVault.clear()

    suspend fun logout() {
        runCatching { api.post("logout") }
        clearLocalSession()
    }

    suspend fun requestRegistration(input: RegistrationInput): JsonObject = api.post("register/request", buildJsonObject {
        put("name", input.name)
        put("phone", input.phone)
        put("store", input.store)
        put("email", input.email)
        put("governorate", input.governorate)
        put("city", input.city)
        put("address", input.address)
        put("password", input.password)
        put("latitude", input.latitude)
        put("longitude", input.longitude)
        put("locationMethod", if (input.useMapLocation) "map" else "manual")
        put("acceptedTerms", input.acceptedTerms)
    })

    suspend fun verifyRegistration(code: String): SessionSnapshot = requestSnapshot { api.post("register/verify", buildJsonObject {
        put("code", code)
    }) }

    suspend fun requestPasswordReset(identifier: String): JsonObject = api.post("password-reset/request", buildJsonObject {
        put("identifier", identifier.trim())
    })

    suspend fun verifyPasswordReset(code: String): JsonObject = api.post("password-reset/verify", buildJsonObject {
        put("code", code)
    })

    suspend fun completePasswordReset(password: String): JsonObject = api.post("password-reset/complete", buildJsonObject {
        put("newPassword", password)
        put("confirmPassword", password)
    })

    suspend fun publicTrack(tracking: String): JsonObject = api.get("track?tracking=${URLEncoder.encode(tracking.trim().uppercase(), "UTF-8")}")

    suspend fun saveDatabase(current: SessionSnapshot, database: JsonObject): SessionSnapshot {
        val epoch = SessionBoundary.current()
        return try {
            requestSnapshot { api.put("database", buildJsonObject {
                put("database", database)
                put("revision", current.revision)
            }) }
        } catch (error: ApiException) {
            if (error.status == 409 && error.payload?.containsKey("database") == true) {
                runCatching { withContext(Dispatchers.Default) { snapshot(error.payload, epoch) } }
            }
            throw error
        }
    }

    suspend fun clearNotices(ids: List<String>): SessionSnapshot = requestSnapshot { api.post("notices/clear", buildJsonObject {
        put("noticeIds", buildJsonArray { ids.forEach { add(JsonPrimitive(it)) } })
    }) }

    suspend fun purgeTrash(current: SessionSnapshot, orderIds: Set<String>, invoiceIds: Set<String>): SessionSnapshot =
        requestSnapshot { api.post("trash/purge", trashPurgeRequest(current, orderIds, invoiceIds)) }

    fun trashConflictSnapshot(error: ApiException, userId: String): SessionSnapshot? {
        val payload = error.payload ?: return null
        if (error.status != 409 || payload.string("userId") != userId || payload["database"] !is JsonObject) return null
        return runCatching { snapshot(payload) }.getOrNull()
    }

    suspend fun broadcast(audience: String, userId: String?, title: String, message: String): SessionSnapshot = requestSnapshot { api.post("notices/broadcast", buildJsonObject {
        put("requestId", "android-${UUID.randomUUID()}")
        put("audience", audience)
        userId?.let { put("recipientUserId", it) }
        put("title", title)
        put("message", message)
    }) }

    suspend fun createOrder(order: JsonObject): SessionSnapshot = requestSnapshot { api.post("orders", buildJsonObject {
        put("orders", buildJsonArray { add(order) })
    }) }

    suspend fun assignParcelCode(orderId: String, trackingNumber: String): SessionSnapshot = requestSnapshot { api.post("orders/assign-code", buildJsonObject {
        put("orderId", orderId)
        put("trackingNumber", normalizeParcelCode(trackingNumber))
    }) }

    suspend fun createParcelCodeBatch(requestId: String, count: Int, label: String): ParcelCodeBatchResult {
        val epoch = SessionBoundary.current()
        val payload = api.post("parcel-code-batches", buildJsonObject {
            put("requestId", requestId)
            put("count", count)
            put("label", label)
        })
        val confirmed = withContext(Dispatchers.Default) { snapshot(payload, epoch) }
        SessionBoundary.withCurrent(epoch) { Unit }
        val batchId = payload.string("batchId")
        require(batchId == requestId && confirmed.parcelCodeBatches.any { it.id == batchId }) {
            "لم يصل تأكيد حجز الأكواد. أعد المحاولة لاستعادة الدفعة نفسها."
        }
        return ParcelCodeBatchResult(confirmed, batchId)
    }

    suspend fun shipScannedOrder(trackingNumber: String): SessionSnapshot = requestSnapshot { api.post("orders/scan", buildJsonObject {
        put("trackingNumber", trackingNumber.trim().uppercase())
    }) }

    suspend fun prepareCollection(invoiceId: String): SessionSnapshot = requestSnapshot { api.post("collections/prepare", buildJsonObject {
        put("invoiceId", invoiceId)
    }) }

    suspend fun verifyCollection(invoiceId: String, code: String): SessionSnapshot = requestSnapshot { api.post("collections/verify", buildJsonObject {
        put("invoiceId", invoiceId)
        put("verificationCode", code)
    }) }

    suspend fun changePassword(current: String, next: String, signOutAll: Boolean): JsonObject = api.post("account/password", buildJsonObject {
        put("currentPassword", current)
        put("newPassword", next)
        put("confirmPassword", next)
        put("signOutAllDevices", signOutAll)
    })

    suspend fun deleteAccount(password: String): JsonObject = api.post("account/delete", buildJsonObject {
        put("password", password)
        put("confirmation", "حذف حسابي")
    })

    suspend fun accountDeletionStatus(): AccountDeletionInfo = accountDeletionInfo(api.get("account/deletion-request"))

    suspend fun requestAccountDeletion(password: String): AccountDeletionInfo = accountDeletionInfo(
        api.post("account/deletion-request", buildJsonObject {
            put("password", password)
            put("confirmation", "حذف حسابي")
        }),
    )

    fun clearLocalSession() = SessionBoundary.invalidate {
        api.clearSession()
        secureStore.clearSession()
        androidx.core.app.NotificationManagerCompat.from(applicationContext).cancelAll()
    }

    fun getPreference(key: String, default: String): String = secureStore.get(key) ?: default
    fun setPreference(key: String, value: String) = secureStore.put(key, value)

    private suspend fun requestSnapshot(block: suspend () -> JsonObject): SessionSnapshot {
        val epoch = SessionBoundary.current()
        try {
            val payload = block()
            val confirmed = withContext(Dispatchers.Default) { snapshot(payload, epoch) }
            // Recheck after dispatching back to the caller as logout can occur
            // after disk work completes but before the UI coroutine resumes.
            return SessionBoundary.withCurrent(epoch) { confirmed }
        } catch (error: Exception) {
            return SessionBoundary.withCurrent(epoch) { throw error }
        }
    }

    private fun snapshot(payload: JsonObject, epoch: Long = SessionBoundary.current()): SessionSnapshot {
        val next = decodeSnapshot(payload.toString()) ?: throw ApiException("استجابة الحساب غير مكتملة. حدّث البيانات قبل المحاولة مجددًا.", 500)
        return SessionBoundary.withCurrent(epoch) {
            val current = cachedSnapshot()
            if (!acceptsSnapshot(current?.userId, current?.revision, next.userId, next.revision)) {
                if (current?.userId == next.userId && current.revision > next.revision) return@withCurrent current
                throw CancellationException("Session changed")
            }
            // This is optional offline persistence, not the server commit.
            if (next != current) runCatching { secureStore.put(SecureStore.KEY_SNAPSHOT, payload.toString()) }
            next
        }
    }

    private fun decodeSnapshot(value: String): SessionSnapshot? = runCatching {
        val payload = json.parseToJsonElement(value).jsonObject
        val database = payload["database"] as? JsonObject ?: return@runCatching null
        val revision = (payload["revision"] as? JsonPrimitive)?.intOrNull ?: return@runCatching null
        val userId = (payload["userId"] as? JsonPrimitive)?.content ?: return@runCatching null
        if (revision < 0 || userId.isBlank() || listOf("users", "orders", "collections", "recipients", "notices").any { database[it] !is JsonArray }) return@runCatching null
        val account = database.array("users").objects().firstOrNull { it.string("id") == userId } ?: return@runCatching null
        if (account.string("role") !in setOf("merchant", "courier", "admin")) return@runCatching null
        SessionSnapshot(database, revision, userId)
    }.getOrNull()

    private fun decodeAvailableAccounts(value: String): List<AvailableAccount> = runCatching {
        val values = json.parseToJsonElement(value) as? JsonArray ?: return@runCatching emptyList()
        values.mapNotNull { it as? JsonObject }.mapNotNull { raw ->
            val email = raw.string("email")
            if (email.isBlank()) null else AvailableAccount(
                id = raw.string("id"),
                email = email,
                name = raw.string("name").ifBlank { "حساب محفوظ" },
                description = raw.string("description"),
            )
        }
    }.getOrDefault(emptyList())

    private fun saveAvailableAccounts(accounts: List<AvailableAccount>) {
        secureStore.put(
            SecureStore.KEY_AVAILABLE_ACCOUNTS,
            buildJsonArray {
                accounts.forEach { account ->
                    add(buildJsonObject {
                        put("id", account.id)
                        put("email", account.email)
                        put("name", account.name)
                        put("description", account.description)
                    })
                }
            }.toString(),
        )
    }

    private companion object {
        const val MAX_AVAILABLE_ACCOUNTS = 6
    }
}
