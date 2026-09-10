package com.almadinaexpress.app

import javax.crypto.Cipher
import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.content.pm.PackageManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.net.toUri
import androidx.core.content.ContextCompat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.fragment.app.FragmentActivity
import com.almadinaexpress.app.ui.AppRoot
import com.almadinaexpress.app.notifications.NotificationHelper
import com.almadinaexpress.app.ui.theme.AlmadinaTheme
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MainActivity : FragmentActivity() {
    private val viewModel: AppViewModel by viewModels()
    private var deepLinkOrderId by mutableStateOf<String?>(null)
    private var scannerCallback: ((String) -> Unit)? = null
    private var requestingNotifications = false
    private var biometricPrompt: BiometricPrompt? = null

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        requestingNotifications = false
        viewModel.notificationPermissionResult(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        deepLinkOrderId = intent?.getStringExtra(EXTRA_ORDER_ID)
        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            AlmadinaTheme(state.theme) {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    AppRoot(
                        state = state,
                        viewModel = viewModel,
                        initialOrderId = deepLinkOrderId,
                        onInitialOrderConsumed = { deepLinkOrderId = null },
                        onRequestNotifications = ::requestNotificationPermission,
                        onScanCode = ::openCodeScanner,
                        onBiometricAuth = ::authenticateBiometric,
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLinkOrderId = intent.getStringExtra(EXTRA_ORDER_ID)
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshNotificationPermission()
        viewModel.foregroundChanged(true)
    }

    override fun onPause() {
        viewModel.foregroundChanged(false)
        super.onPause()
    }

    override fun onDestroy() {
        biometricPrompt?.cancelAuthentication()
        biometricPrompt = null
        super.onDestroy()
    }

    private fun requestNotificationPermission() {
        if (requestingNotifications) return
        viewModel.refreshNotificationPermission()
        if (NotificationHelper.notificationsAllowed(this)) {
            viewModel.setNotifications(true)
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            val history = getSharedPreferences("permission-history", MODE_PRIVATE)
            if (history.getBoolean("notifications-requested", false) && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                openNotificationSettings()
                return
            }
            history.edit().putBoolean("notifications-requested", true).apply()
            requestingNotifications = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            openNotificationSettings()
        }
    }

    private fun openNotificationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            }
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = "package:$packageName".toUri()
            }
        }
        startActivity(intent)
    }

    private fun openCodeScanner(onResult: (String) -> Unit) {
        if (scannerCallback != null) return
        scannerCallback = onResult
        val accountId = viewModel.state.value.snapshot?.currentUser?.id
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128)
            .enableAutoZoom()
            .build()
        try {
            GmsBarcodeScanning.getClient(this, options).startScan()
                .addOnSuccessListener { barcode ->
                    val callback = scannerCallback
                    scannerCallback = null
                    if (isFinishing || isDestroyed || viewModel.state.value.snapshot?.currentUser?.id != accountId) return@addOnSuccessListener
                    val value = barcode.rawValue?.trim().orEmpty()
                    if (value.isBlank()) viewModel.reportScannerError("لم نتمكن من قراءة الكود. وجّه الكاميرا إلى رمز QR وحاول مجددًا.")
                    else callback?.invoke(value)
                }
                .addOnFailureListener {
                    scannerCallback = null
                    if (!isFinishing && !isDestroyed && viewModel.state.value.snapshot?.currentUser?.id == accountId) {
                        viewModel.reportScannerError("تعذّر تشغيل قارئ QR. تأكد من توفر الكاميرا وتحديث خدمات Google Play ثم أعد المحاولة.")
                    }
                }
                .addOnCanceledListener { scannerCallback = null }
        } catch (_: Exception) {
            scannerCallback = null
            viewModel.reportScannerError("تعذّر فتح الكاميرا لقراءة QR. حاول مجددًا.")
        }
    }

    private fun authenticateBiometric(onAuthenticated: (Cipher) -> Unit, onError: (String) -> Unit) {
        if (biometricPrompt != null || viewModel.state.value.busy) return
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
        when (BiometricManager.from(this).canAuthenticate(authenticators)) {
            BiometricManager.BIOMETRIC_SUCCESS -> Unit
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> {
                onError("لا توجد بصمة إصبع أو وجه مسجّلة على الهاتف. أضفها من إعدادات قفل الشاشة أولًا.")
                return
            }
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> {
                onError("هذا الجهاز لا يدعم بصمة الإصبع أو بصمة الوجه.")
                return
            }
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> {
                onError("مستشعر البصمة غير متاح الآن. حاول مرة أخرى بعد قليل.")
                return
            }
            else -> {
                onError("تعذّر استخدام البصمة على هذا الجهاز. تحقق من إعدادات الأمان.")
                return
            }
        }

        val cipher = try { viewModel.prepareBiometricCipher() } catch (_: Exception) {
            onError("تعذّر فتح بيانات البصمة. سجّل الدخول بكلمة المرور ثم أعد تفعيل البصمة من الإعدادات.")
            return
        }
        val epoch = viewModel.sessionGeneration
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    biometricPrompt = null
                    val authorizedCipher = result.cryptoObject?.cipher
                    if (isFinishing || isDestroyed || epoch != viewModel.sessionGeneration) return
                    if (authorizedCipher == null) onError("لم يكتمل التحقق الآمن من البصمة. حاول مجددًا.")
                    else onAuthenticated(authorizedCipher)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    biometricPrompt = null
                    if (errorCode !in listOf(
                            BiometricPrompt.ERROR_USER_CANCELED,
                            BiometricPrompt.ERROR_CANCELED,
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                        )
                    ) {
                        onError(errString.toString().ifBlank { "تعذّر التحقق من البصمة." })
                    }
                }
            },
        )
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("المدينة إكسبرس")
            .setSubtitle("استخدم بصمة الإصبع أو بصمة الوجه")
            .setAllowedAuthenticators(authenticators)
            .setNegativeButtonText("إلغاء")
            .build()
        biometricPrompt = prompt
        try { prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher)) }
        catch (_: Exception) {
            biometricPrompt = null
            onError("تعذّر التحقق الآمن من البصمة. استخدم كلمة المرور أو حاول مجددًا.")
        }
    }

    companion object {
        const val EXTRA_ORDER_ID = "orderId"
    }
}
