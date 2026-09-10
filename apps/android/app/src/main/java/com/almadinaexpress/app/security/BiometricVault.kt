package com.almadinaexpress.app.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only a successful CryptoObject prompt can use this device-bound key. */
class BiometricVault(private val store: SecureStore) {
    private fun key(): SecretKey {
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keys.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        else {
            @Suppress("DEPRECATION")
            spec.setUserAuthenticationValidityDurationSeconds(-1)
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec.build()) }.generateKey()
    }

    fun prepare(enrolling: Boolean): Cipher {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val sealed = if (enrolling) null else store.get(SecureStore.KEY_BIOMETRIC_SECRET)
        if (sealed == null) {
            try { cipher.init(Cipher.ENCRYPT_MODE, key()) }
            catch (error: KeyPermanentlyInvalidatedException) {
                if (!enrolling) throw error
                // Re-enrollment still requires the password and a new strong
                // biometric prompt. Never recover an old secret with a new key.
                clear()
                cipher.init(Cipher.ENCRYPT_MODE, key())
            }
        }
        else {
            val bytes = Base64.decode(sealed, Base64.NO_WRAP)
            require(bytes.size > 28) { "أعد تفعيل البصمة من الإعدادات." }
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        }
        return cipher
    }

    fun save(password: String, authorizedCipher: Cipher) {
        val encrypted = authorizedCipher.doFinal(password.toByteArray(Charsets.UTF_8))
        store.put(SecureStore.KEY_BIOMETRIC_SECRET, Base64.encodeToString(authorizedCipher.iv + encrypted, Base64.NO_WRAP))
        store.remove(SecureStore.KEY_BIOMETRIC_PASSWORD)
    }

    fun read(authorizedCipher: Cipher): String {
        val sealed = store.get(SecureStore.KEY_BIOMETRIC_SECRET)
        if (sealed != null) {
            val bytes = Base64.decode(sealed, Base64.NO_WRAP)
            require(bytes.size > 28) { "أعد تفعيل البصمة من الإعدادات." }
            return String(authorizedCipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        }
        // Upgrade the earlier encrypted credential after a strong biometric
        // prompt. Remove the legacy copy only after the new encryption succeeds.
        val legacy = store.get(SecureStore.KEY_BIOMETRIC_PASSWORD)
        require(!legacy.isNullOrBlank()) { "أعد تفعيل الدخول بالبصمة من الإعدادات." }
        save(legacy, authorizedCipher)
        return legacy
    }

    fun clear() {
        store.clearBiometricCredentials()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }

    private companion object { const val ALIAS = "almadina_biometric_key_v3" }
}
