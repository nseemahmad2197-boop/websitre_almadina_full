package com.almadinaexpress.app.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context) {
    private val preferences = context.getSharedPreferences("secure_store", Context.MODE_PRIVATE)

    fun put(key: String, value: String) {
        preferences.edit { putString(key, encrypt(value)) }
    }

    fun get(key: String): String? {
        val encrypted = preferences.getString(key, null) ?: return null
        return runCatching { decrypt(encrypted) }.getOrNull()
    }

    fun remove(key: String) {
        preferences.edit { remove(key) }
    }

    fun clearSession() {
        preferences.edit {
            remove(KEY_COOKIES)
            remove(KEY_SNAPSHOT)
            remove(KEY_KNOWN_NOTICES)
        }
    }

    fun clearBiometricCredentials() {
        preferences.edit {
            remove(KEY_BIOMETRIC_ENABLED)
            remove(KEY_BIOMETRIC_EMAIL)
            remove(KEY_BIOMETRIC_PASSWORD)
            remove(KEY_BIOMETRIC_SECRET)
        }
    }

    private fun getOrCreateKey(): SecretKey = synchronized(keyLock) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return@synchronized it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(bytes.size > IV_SIZE)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_SIZE)))
        return String(cipher.doFinal(bytes.copyOfRange(IV_SIZE, bytes.size)), StandardCharsets.UTF_8)
    }

    companion object {
        const val KEY_COOKIES = "cookies"
        const val KEY_SNAPSHOT = "snapshot"
        const val KEY_KNOWN_NOTICES = "known_notices"
        const val KEY_THEME = "theme"
        const val KEY_SOUNDS = "sounds"
        const val KEY_NOTIFICATIONS = "notifications"
        const val KEY_BIOMETRIC_ENABLED = "biometric_enabled"
        const val KEY_BIOMETRIC_EMAIL = "biometric_email"
        const val KEY_BIOMETRIC_PASSWORD = "biometric_password"
        const val KEY_BIOMETRIC_SECRET = "biometric_secret_v3"
        const val KEY_AVAILABLE_ACCOUNTS = "available_accounts"
        private const val KEY_ALIAS = "almadina_express_device_key_v2"
        private const val IV_SIZE = 12
        private val keyLock = Any()
    }
}
