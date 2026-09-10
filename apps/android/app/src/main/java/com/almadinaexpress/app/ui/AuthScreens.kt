package com.almadinaexpress.app.ui

import androidx.compose.runtime.remember

import javax.crypto.Cipher

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.RegistrationInput
import com.almadinaexpress.app.data.displayDate
import com.almadinaexpress.app.data.string
import com.almadinaexpress.app.ui.theme.BrandGreen
import com.almadinaexpress.app.ui.theme.BrandGreenDark
import kotlinx.serialization.json.jsonObject

private enum class AuthMode { LOGIN, REGISTER }

internal const val LEGAL_VERSION = "2026-09-09"

internal val termsSummary = listOf(
    "إنشاء الحساب وصحة البيانات" to "يجب إدخال بيانات صحيحة وحديثة، وحماية كلمة المرور ورموز التحقق وعدم مشاركة الحساب دون إذن.",
    "الطرود والمحتويات" to "يلتزم المرسل بوصف المحتوى وتغليفه بصورة صحيحة وعدم إرسال مواد محظورة أو مخالفة للقانون.",
    "الرسوم والتحصيل والرواجع" to "تظهر الرسوم قبل إنشاء الطرد، وتُسجّل التحصيلات والرواجع داخل الحساب ويؤكدها الموظف أو المسؤول.",
    "طلب حذف الحساب والتسوية" to "يمكن تقديم طلب حذف الحساب من الإعدادات أو الموقع حتى مع وجود طرود نشطة أو فواتير مستحقة، وتظهر حالة الطلب ورقمه وموعد مراجعته. لا يلزم الاتصال بالدعم لتقديم الطلب. تُعالج الالتزامات القائمة قبل اكتمال الحذف، ولا يُسقط طلب الحذف المستحقات.",
)

internal val privacySummary = listOf(
    "السجلات التقنية" to "يسجّل الخادم نوع العملية ونتيجتها ومدتها ورقمًا عشوائيًا لتتبع الطلب لتشخيص الأخطاء وحماية الخدمة، دون كلمات المرور أو رموز الدخول أو محتوى الطرود والعناوين. يحتفظ التطبيق محليًا برمز الخطأ ورقم الطلب فقط. راجع سياسة الخصوصية على الموقع لتفاصيل سجلات الاستضافة.",
    "الدخول بالبصمة" to "اختياري. تُحفظ كلمة المرور لهذه الميزة مشفّرة بمفتاح على الجهاز لا يُستخدم إلا بعد تحقق حيوي قوي. لا نحصل على صورة وجهك أو بصمتك. بعد تغيير البصمات قد يلزم تسجيل الدخول بكلمة المرور وإعادة التفعيل.",
    "البيانات التي نجمعها" to "نجمع بيانات الحساب والمتجر والمستلمين والطرود والعناوين اللازمة لتقديم الخدمة.",
    "استخدام البيانات" to "تُستخدم البيانات للتوصيل والتحصيل وتحديث الحالات وحماية الجلسة، ولا تُباع لأغراض إعلانية.",
    "الحماية والاحتفاظ" to "نستخدم جلسات آمنة وتجزئة لكلمات المرور. تعرض سياسة الحذف على الموقع أنواع البيانات اللازمة للتسوية والالتزامات النظامية وأسباب الاحتفاظ بها؛ تُزال بيانات الحساب الأخرى عند اكتمال الحذف.",
    "حقوقك" to "يمكنك عرض بياناتك وضبط الإشعارات وتغيير كلمة المرور وتقديم طلب حذف الحساب ومتابعته من الإعدادات أو رابط الحذف على الموقع، دون اشتراط تثبيت التطبيق أو الاتصال بالدعم لبدء الطلب.",
)

@Composable
fun AuthScreen(
    state: MainUiState,
    viewModel: AppViewModel,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
) {
    var mode by rememberSaveable { mutableStateOf(AuthMode.LOGIN) }
    val gradient = Brush.verticalGradient(listOf(BrandGreenDark, BrandGreen, MaterialTheme.colorScheme.background))

    BoxWithConstraints(Modifier.fillMaxSize().background(gradient).systemBarsPadding()) {
        val horizontalPadding = if (maxWidth >= 600.dp) 28.dp else 18.dp
        val cardPadding = if (maxWidth >= 600.dp) 24.dp else 18.dp
        Column(
            Modifier
                .align(Alignment.TopCenter)
                .widthIn(max = 660.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = horizontalPadding, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Spacer(Modifier.height(8.dp))
            Surface(Modifier.size(92.dp), shape = RoundedCornerShape(28.dp), color = Color.White.copy(alpha = .96f)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.LocalShipping, null, Modifier.size(52.dp), tint = BrandGreen)
                }
            }
            Text("المدينة إكسبرس", color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.ExtraBold)
            Text("ALMADINA EXPRESS", color = Color.White.copy(alpha = .78f), letterSpacing = 4.sp, fontSize = 11.sp)

            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(28.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .34f)),
                shadowElevation = 8.dp,
            ) {
                Column(Modifier.padding(cardPadding), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (state.booting) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text(
                            "جارٍ التحقق من الجلسة والاتصال بالخادم…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    state.message?.let { message ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            color = if (state.messageError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer,
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(start = 8.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                IconButton(onClick = viewModel::consumeMessage) {
                                    Icon(Icons.Outlined.Close, "إغلاق الرسالة")
                                }
                            }
                        }
                    }
                    AnimatedContent(mode, label = "auth-mode") { selected ->
                        when (selected) {
                            AuthMode.LOGIN -> LoginLanding(
                                state = state,
                                viewModel = viewModel,
                                onCreateAccount = { mode = AuthMode.REGISTER },
                                onBiometricAuth = onBiometricAuth,
                            )
                            AuthMode.REGISTER -> RegistrationForm(
                                state = state,
                                viewModel = viewModel,
                                onBackToLogin = { mode = AuthMode.LOGIN },
                            )
                        }
                    }
                }
            }
            Text(
                "تطبيق أندرويد أصلي · اتصال مشفّر بقاعدة بيانات الموقع",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodySmall,
            )
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    PublicPolicyLinks()
                    PublicWebsiteLink("التواصل مع الدعم", "/support")
                }
            }
        }
    }
}

@Composable
private fun LoginLanding(
    state: MainUiState,
    viewModel: AppViewModel,
    onCreateAccount: () -> Unit,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
) {
    if (state.passwordResetStep != null) {
        PasswordResetForm(state, viewModel)
        return
    }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var accountsExpanded by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("تسجيل الدخول", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
        Text("أدخل بيانات حساب المدينة إكسبرس.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        AppField(email, { email = it }, "البريد الإلكتروني")
        AppField(password, { password = it }, "كلمة المرور", visualTransformation = PasswordVisualTransformation())
        PrimaryButton("تسجيل الدخول", { viewModel.login(email, password) }, enabled = !state.booting, busy = state.busy)
        if (state.biometricLoginAvailable) {
            OutlinedButton(
                onClick = {
                    onBiometricAuth(
                        viewModel::loginWithBiometrics,
                        viewModel::reportBiometricError,
                    )
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                enabled = !state.booting && !state.busy,
                shape = RoundedCornerShape(12.dp),
            ) {
                Icon(Icons.Outlined.Fingerprint, null)
                Spacer(Modifier.size(8.dp))
                Text("الدخول ببصمة الإصبع أو الوجه", fontWeight = FontWeight.Bold)
            }
        }
        OutlinedButton(
            onClick = { accountsExpanded = !accountsExpanded },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            enabled = state.availableAccounts.isNotEmpty() && !state.busy,
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Outlined.AccountCircle, null)
            Spacer(Modifier.size(8.dp))
            Text(
                if (state.availableAccounts.isEmpty()) "لا توجد حسابات محفوظة"
                else "الحسابات المتاحة (${state.availableAccounts.size})",
                fontWeight = FontWeight.Bold,
            )
        }
        if (accountsExpanded && state.availableAccounts.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                state.availableAccounts.forEach { account ->
                    OutlinedButton(
                        onClick = {
                            email = account.email
                            password = ""
                            accountsExpanded = false
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 58.dp),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(Icons.Outlined.AccountCircle, null)
                        Spacer(Modifier.size(10.dp))
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                            Text(account.name, fontWeight = FontWeight.Bold)
                            if (account.description.isNotBlank()) {
                                Text(
                                    account.description,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
        TextButton(onClick = viewModel::beginPasswordReset) { Text("نسيت كلمة المرور؟") }

        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .45f))
        Text(
            "ليس لديك حساب؟",
            Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = onCreateAccount,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Outlined.PersonAdd, null)
            Spacer(Modifier.size(8.dp))
            Text("إنشاء حساب جديد", fontWeight = FontWeight.Bold)
        }

        HorizontalDivider(Modifier.padding(vertical = 4.dp), color = MaterialTheme.colorScheme.outline.copy(alpha = .45f))
        PublicTrackingForm(state, viewModel)
    }
}

@Composable
private fun PasswordResetForm(state: MainUiState, viewModel: AppViewModel) {
    var identifier by rememberSaveable { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("استعادة كلمة المرور", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
        when (state.passwordResetStep) {
            "request" -> {
                Text("أدخل البريد الإلكتروني المسجّل ليصلك رمز تحقق.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                AppField(identifier, { identifier = it }, "البريد الإلكتروني")
                PrimaryButton("إرسال رمز التحقق", { viewModel.requestPasswordReset(identifier) }, busy = state.busy)
            }
            "verify" -> {
                Text("أدخل الرمز المكوّن من 6 أرقام.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                AppField(code, { code = it.filter(Char::isDigit).take(6) }, "رمز التحقق")
                PrimaryButton("التحقق من الرمز", { viewModel.verifyPasswordReset(code) }, busy = state.busy)
            }
            "complete" -> {
                Text("اختر كلمة مرور جديدة تحتوي على حرف ورقم ورمز.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                AppField(password, { password = it }, "كلمة المرور الجديدة", visualTransformation = PasswordVisualTransformation())
                AppField(confirm, { confirm = it }, "تأكيد كلمة المرور", visualTransformation = PasswordVisualTransformation())
                PrimaryButton("حفظ كلمة المرور", { viewModel.completePasswordReset(password, confirm) }, busy = state.busy)
            }
        }
        TextButton(onClick = viewModel::cancelPasswordReset) { Text("العودة إلى تسجيل الدخول") }
    }
}

@Composable
private fun RegistrationForm(state: MainUiState, viewModel: AppViewModel, onBackToLogin: () -> Unit) {
    if (state.registrationEmail != null) {
        var code by remember { mutableStateOf("") }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("تأكيد البريد الإلكتروني", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("أدخل الرمز المرسل إلى ${state.registrationEmail}")
            AppField(code, { code = it.filter(Char::isDigit).take(6) }, "رمز التحقق")
            PrimaryButton("تأكيد وإنشاء الحساب", { viewModel.verifyRegistration(code) }, busy = state.busy)
            TextButton(onClick = viewModel::cancelRegistrationCode) { Text("العودة وتعديل البيانات") }
            TextButton(onClick = {
                viewModel.cancelRegistrationCode()
                onBackToLogin()
            }) { Text("العودة إلى تسجيل الدخول") }
        }
        return
    }

    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var store by rememberSaveable { mutableStateOf("") }
    var cityName by rememberSaveable { mutableStateOf("") }
    var areaName by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var acceptedTerms by rememberSaveable { mutableStateOf(false) }
    var legalOpen by rememberSaveable { mutableStateOf(false) }
    var step by rememberSaveable { mutableIntStateOf(1) }
    var stepError by rememberSaveable { mutableStateOf<String?>(null) }
    val displayedStep = step.coerceAtMost(4)

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                Text("إنشاء حساب جديد", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                Text("الخطوة $displayedStep من 4", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onBackToLogin) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, "العودة إلى تسجيل الدخول")
            }
        }
        LinearProgressIndicator(progress = { displayedStep / 4f }, modifier = Modifier.fillMaxWidth())

        AnimatedContent(step, label = "registration-step") { currentStep ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (currentStep) {
                    1 -> {
                        RegistrationStepTitle(Icons.Outlined.Badge, "لنبدأ بمعلوماتك", "أدخل الاسم ورقم الجوال المستخدم في حسابك.")
                        AppField(name, { name = it }, "الاسم الكامل")
                        AppField(phone, { phone = it.filter(Char::isDigit).take(10) }, "رقم الجوال 05xxxxxxxx")
                    }
                    2 -> {
                        RegistrationStepTitle(Icons.Outlined.Storefront, "بيانات متجرك", "هذه البيانات ستظهر في الطرود والتحصيلات.")
                        AppField(store, { store = it }, "اسم المتجر")
                        AppField(email, { email = it.trim() }, "البريد الإلكتروني")
                    }
                    3 -> {
                        RegistrationStepTitle(Icons.Outlined.LocationOn, "العنوان الخاص بك", "أدخل المدينة والمنطقة ووصف العنوان بالتفصيل.")
                        AppField(cityName, { cityName = it }, "المدينة")
                        AppField(areaName, { areaName = it }, "المنطقة")
                        AppField(address, { address = it }, "الشارع / وصف العنوان", leadingIcon = { Icon(Icons.Outlined.LocationOn, null) })
                    }
                    4 -> {
                        RegistrationStepTitle(Icons.Outlined.Lock, "حماية حسابك", "استخدم كلمة مرور من 8 خانات تحتوي على رقم ورمز.")
                        AppField(password, { password = it }, "كلمة المرور", visualTransformation = PasswordVisualTransformation())
                        AppField(confirmPassword, { confirmPassword = it }, "تأكيد كلمة المرور", visualTransformation = PasswordVisualTransformation())
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = acceptedTerms, onCheckedChange = { acceptedTerms = it })
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                                Text("قرأت وأوافق على شروط الاستخدام وسياسة الخصوصية.", style = MaterialTheme.typography.bodySmall)
                                TextButton(onClick = { legalOpen = true }) { Text("عرض الوثائق والأذونات") }
                            }
                        }
                    }
                    else -> {
                        RegistrationStepTitle(Icons.Outlined.CheckCircle, "لم يتبق الكثير", "راجع معلومات الحساب قبل إرسال رمز التحقق.")
                        RegistrationSummary(
                            name = name,
                            phone = phone,
                            store = store,
                            email = email,
                            cityName = cityName,
                            areaName = areaName,
                            address = address,
                        )
                    }
                }
            }
        }

        stepError?.let {
            Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
            }
        }

        AdaptiveItemRow(itemCount = if (step > 1) 2 else 1, stackBelow = 350.dp, spacing = 10.dp) { index, itemModifier ->
            if (step > 1 && index == 0) {
                OutlinedButton(
                    onClick = {
                        step--
                        stepError = null
                    },
                    modifier = itemModifier.heightIn(min = 52.dp),
                    shape = RoundedCornerShape(12.dp),
                ) { Text("السابق") }
            } else PrimaryButton(
                text = when {
                    step < 4 -> "التالي"
                    step == 4 -> "مراجعة البيانات"
                    else -> "إرسال رمز التحقق"
                },
                onClick = {
                    val error = registrationStepError(
                        step = step,
                        name = name,
                        phone = phone,
                        store = store,
                        email = email,
                        cityName = cityName,
                        areaName = areaName,
                        address = address,
                        password = password,
                        confirmPassword = confirmPassword,
                        acceptedTerms = acceptedTerms,
                    )
                    if (error != null) {
                        stepError = error
                    } else if (step < 5) {
                        step++
                        stepError = null
                    } else {
                        viewModel.requestRegistration(
                            RegistrationInput(
                                name = name,
                                phone = phone,
                                store = store,
                                email = email,
                                governorate = cityName,
                                city = areaName,
                                address = address,
                                password = password,
                                acceptedTerms = acceptedTerms,
                            )
                        )
                    }
                },
                modifier = itemModifier,
                enabled = !state.booting,
                busy = state.busy,
            )
        }
    }
    if (legalOpen) {
        LegalDialog(
            onDismiss = { legalOpen = false },
            onAccept = {
                acceptedTerms = true
                legalOpen = false
            },
        )
    }
}

@Composable
private fun RegistrationStepTitle(icon: ImageVector, title: String, subtitle: String) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(Modifier.size(52.dp), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.primaryContainer) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary) }
        }
    }
}

@Composable
private fun RegistrationSummary(
    name: String,
    phone: String,
    store: String,
    email: String,
    cityName: String,
    areaName: String,
    address: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            listOf(
                "الاسم" to name,
                "رقم الجوال" to phone,
                "المتجر" to store,
                "البريد الإلكتروني" to email,
                "المدينة" to cityName,
                "المنطقة" to areaName,
                "الشارع / وصف العنوان" to address,
            ).forEach { (label, value) ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(value, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                    Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
    ) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("تمت الموافقة على الشروط وسياسة الخصوصية.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
        }
    }
}

private fun registrationStepError(
    step: Int,
    name: String,
    phone: String,
    store: String,
    email: String,
    cityName: String,
    areaName: String,
    address: String,
    password: String,
    confirmPassword: String,
    acceptedTerms: Boolean,
): String? = when (step) {
    1 -> when {
        name.trim().length < 2 -> "أدخل الاسم الكامل."
        !Regex("^05[0-9]{8}$").matches(phone) -> "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام."
        else -> null
    }
    2 -> when {
        store.trim().isEmpty() -> "أدخل اسم المتجر."
        !android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches() -> "البريد الإلكتروني غير صحيح."
        else -> null
    }
    3 -> if (cityName.isBlank() || areaName.isBlank() || address.trim().length < 2) "أدخل المدينة والمنطقة والشارع أو وصف العنوان." else null
    4 -> when {
        password.length < 8 || !password.any(Char::isDigit) || password.none { !it.isLetterOrDigit() } -> "كلمة المرور يجب أن تحتوي على 8 خانات على الأقل ورقم ورمز."
        password != confirmPassword -> "تأكيد كلمة المرور غير مطابق."
        !acceptedTerms -> "يجب الموافقة على شروط الاستخدام وسياسة الخصوصية."
        else -> null
    }
    else -> null
}

@Composable
private fun LegalDialog(onDismiss: () -> Unit, onAccept: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("الشروط والخصوصية والأذونات") },
        text = {
            Column(
                Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("نسخة $LEGAL_VERSION", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("شروط الاستخدام", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                termsSummary.forEachIndexed { index, entry ->
                    Text("${index + 1}. ${entry.first}", fontWeight = FontWeight.Bold)
                    Text(entry.second, style = MaterialTheme.typography.bodySmall)
                }
                Text("سياسة الخصوصية", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                privacySummary.forEachIndexed { index, entry ->
                    Text("${index + 1}. ${entry.first}", fontWeight = FontWeight.Bold)
                    Text(entry.second, style = MaterialTheme.typography.bodySmall)
                }
                Text("الأذونات", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "الإشعارات اختيارية. الكاميرا تُفتح عبر ماسح Google Code Scanner فقط عند طلبك ولا يحتفظ التطبيق بصورة أو فيديو. ويمكن إدخال الأكواد يدويًا.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text("يجب أن يكون الطرد مطابقًا للوصف المكتوب.", fontWeight = FontWeight.Bold)
                PublicPolicyLinks()
            }
        },
        confirmButton = { TextButton(onClick = onAccept) { Text("أوافق") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } },
    )
}

@Composable
private fun PublicTrackingForm(state: MainUiState, viewModel: AppViewModel) {
    var tracking by rememberSaveable { mutableStateOf("") }
    val order = state.publicTracking?.get("order")?.jsonObject
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("تتبع طردك", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
        Text(
            "أدخل رقم التتبع مباشرة دون تسجيل الدخول.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        AppField(tracking, { tracking = it.uppercase() }, "ALX-000000", leadingIcon = { Icon(Icons.Outlined.Search, null) })
        PrimaryButton("تتبع الطرد", { viewModel.publicTrack(tracking) }, icon = Icons.Outlined.Search, busy = state.busy)
        order?.let {
            Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(it.string("trackingNumber"), fontWeight = FontWeight.ExtraBold)
                    Text("الحالة: ${com.almadinaexpress.app.data.OrderStatus.from(it.string("status")).arabic}")
                    Text("آخر تحديث: ${displayDate(it.string("updatedAt"))}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
fun LoadingScreen() {
    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(BrandGreenDark, BrandGreen))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Surface(Modifier.size(96.dp), shape = RoundedCornerShape(28.dp), color = Color.White) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.LocalShipping, null, Modifier.size(54.dp), tint = BrandGreen)
                }
            }
            Text("المدينة إكسبرس", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp)
            Text("جارٍ الاتصال بقاعدة البيانات…", color = Color.White.copy(alpha = .8f))
        }
    }
}
