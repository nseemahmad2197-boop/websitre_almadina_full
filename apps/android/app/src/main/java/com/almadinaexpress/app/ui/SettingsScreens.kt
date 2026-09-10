package com.almadinaexpress.app.ui

import javax.crypto.Cipher

import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Brightness4
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.NotificationAdd
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.BuildConfig
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.displayDate
import com.almadinaexpress.app.data.safeDeletionReceiptUrl
import com.almadinaexpress.app.ui.theme.THEME_DARK
import com.almadinaexpress.app.ui.theme.THEME_LIGHT
import com.almadinaexpress.app.ui.theme.THEME_SYSTEM

@Composable
fun SettingsScreen(
    state: MainUiState,
    viewModel: AppViewModel,
    onNavigate: (Destination) -> Unit,
    onRequestNotifications: () -> Unit,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
) {
    val user = state.snapshot?.currentUser ?: return
    val biometricEnabledForCurrentUser = state.biometricLoginAvailable &&
        state.biometricAccountEmail.equals(user.email, ignoreCase = true)
    var themeDialog by remember { mutableStateOf(false) }
    var passwordDialog by remember { mutableStateOf(false) }
    var biometricDialog by remember { mutableStateOf(false) }
    var deleteDialog by remember { mutableStateOf(false) }
    var logoutDialog by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ScreenHeader("الإعدادات", user.email, onBack = { onNavigate(Destination.HOME) }) }
        item {
            SettingsRow(Icons.Outlined.AccountCircle, "الملف الشخصي", if (user.role == Role.ADMIN) "تعديل بيانات المسؤول" else "بيانات الحساب للعرض") { onNavigate(Destination.PROFILE) }
            SettingsRow(Icons.Outlined.Key, "تغيير كلمة المرور", "إنشاء كلمة مرور قوية وتسجيل الخروج من الأجهزة") { passwordDialog = true }
            SettingsRow(
                Icons.Outlined.Brightness4,
                "مظهر التطبيق",
                when (state.theme) {
                    THEME_DARK -> "داكن"
                    THEME_SYSTEM -> "تلقائي"
                    else -> "فاتح (الافتراضي)"
                },
            ) { themeDialog = true }
        }
        item {
            Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = biometricEnabledForCurrentUser,
                        onCheckedChange = { enabled ->
                            if (enabled) biometricDialog = true else viewModel.disableBiometricLogin()
                        },
                    )
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp), horizontalAlignment = Alignment.End) {
                        Text("الدخول بالبصمة", fontWeight = FontWeight.Bold)
                        Text(
                            if (biometricEnabledForCurrentUser) "مفعّل لبصمة الإصبع أو الوجه على هذا الجهاز"
                            else "فعّل الدخول السريع بعد التحقق من كلمة المرور",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Icon(Icons.Outlined.Fingerprint, null, tint = MaterialTheme.colorScheme.primary)
                }
            }
            Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = state.notifications, onCheckedChange = {
                        viewModel.setNotifications(it)
                        if (it) onRequestNotifications()
                    })
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp), horizontalAlignment = Alignment.End) {
                        Text("إشعارات التطبيق", fontWeight = FontWeight.Bold)
                        Text("عرض تحديثات الطرود والتحصيلات على الهاتف", style = MaterialTheme.typography.bodySmall)
                    }
                    Icon(Icons.Outlined.NotificationsActive, null, tint = MaterialTheme.colorScheme.primary)
                }
            }
            Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = state.sounds, onCheckedChange = viewModel::setSounds)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp), horizontalAlignment = Alignment.End) {
                        Text("أصوات الإشعارات", fontWeight = FontWeight.Bold)
                        Text("صوت واهتزاز عند وصول تحديث جديد", style = MaterialTheme.typography.bodySmall)
                    }
                    Icon(Icons.AutoMirrored.Outlined.VolumeUp, null, tint = MaterialTheme.colorScheme.primary)
                }
            }
            SettingsRow(
                Icons.Outlined.NotificationsActive,
                "إشعارات الهاتف",
                if (state.notificationPermissionGranted) "الإذن مسموح على هذا الجهاز" else "الإذن أو قناة الإشعارات غير مفعّل؛ اضغط للسماح",
            ) { onRequestNotifications() }
            SettingsRow(Icons.Outlined.NotificationAdd, "اختبار الصوت والإشعار", "إرسال إشعار تجريبي إلى هذا الهاتف") { viewModel.testNotification() }
            SettingsRow(
                Icons.Outlined.Security,
                "الخصوصية والأمان",
                "شروط الاستخدام وسياسة الخصوصية والأذونات",
            ) { onNavigate(Destination.LEGAL) }
            SettingsRow(
                Icons.AutoMirrored.Outlined.HelpOutline,
                "مركز المساعدة",
                "الأسئلة الشائعة والتواصل مع الدعم",
            ) { onNavigate(Destination.HELP_CENTER) }
        }
        item {
            SettingsRow(Icons.AutoMirrored.Outlined.Logout, "تسجيل الخروج", "إنهاء الجلسة على هذا الجهاز", danger = true) { logoutDialog = true }
            if (user.role != Role.ADMIN) SettingsRow(Icons.Outlined.DeleteForever, "حذف الحساب", "تقديم طلب الحذف ومتابعته، حتى مع وجود التزامات", danger = true) { deleteDialog = true }
        }
        item {
            Text("المدينة إكسبرس — تطبيق Android أصلي ${BuildConfig.VERSION_NAME}", Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(80.dp))
        }
    }

    if (themeDialog) AlertDialog(
        onDismissRequest = { themeDialog = false },
        title = { Text("مظهر التطبيق") },
        text = {
            Column {
                listOf(
                    THEME_LIGHT to "فاتح (الافتراضي)",
                    THEME_DARK to "داكن",
                    THEME_SYSTEM to "تلقائي (حسب إعداد الهاتف)",
                ).forEach { (id, label) ->
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            viewModel.setTheme(id)
                            themeDialog = false
                        }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = state.theme == id, onClick = null)
                        Text(label)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { themeDialog = false }) { Text("إغلاق") } },
    )
    if (biometricDialog) EnableBiometricDialog(
        state = state,
        viewModel = viewModel,
        onBiometricAuth = onBiometricAuth,
        onDismiss = { biometricDialog = false },
    )
    if (passwordDialog) ChangePasswordDialog(state, viewModel) { passwordDialog = false }
    if (deleteDialog) DeleteAccountDialog(state, viewModel) { deleteDialog = false }
    if (logoutDialog) AlertDialog(
        onDismissRequest = { logoutDialog = false },
        title = { Text("تسجيل الخروج؟") },
        text = { Text("يمكنك تسجيل الدخول مجددًا بنفس حساب الموقع.") },
        confirmButton = { TextButton(onClick = { logoutDialog = false; viewModel.logout() }) { Text("تسجيل الخروج") } },
        dismissButton = { TextButton(onClick = { logoutDialog = false }) { Text("إلغاء") } },
    )
}

@Composable
private fun EnableBiometricDialog(
    state: MainUiState,
    viewModel: AppViewModel,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تفعيل الدخول بالبصمة") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("أدخل كلمة المرور الحالية، ثم أكّد بصمة الإصبع أو الوجه. سيظهر زر البصمة في شاشة الدخول على هذا الجهاز فقط.")
                AppField(password, { password = it }, "كلمة المرور الحالية", visualTransformation = PasswordVisualTransformation())
            }
        },
        confirmButton = {
            TextButton(
                enabled = password.isNotBlank() && !state.busy,
                onClick = {
                    onBiometricAuth(
                        { cipher -> viewModel.enableBiometricLogin(password, cipher, onDismiss) },
                        viewModel::reportBiometricError,
                    )
                },
            ) { Text("التحقق والتفعيل") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
private fun SettingsRow(icon: ImageVector, title: String, subtitle: String, danger: Boolean = false, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .72f)),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                Text(title, fontWeight = FontWeight.Bold, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(icon, null, Modifier.padding(start = 14.dp), tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun ChangePasswordDialog(state: MainUiState, viewModel: AppViewModel, onDismiss: () -> Unit) {
    var current by rememberSaveable { mutableStateOf("") }
    var next by rememberSaveable { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var signOutAll by rememberSaveable { mutableStateOf(true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تغيير كلمة المرور") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                AppField(current, { current = it }, "كلمة المرور الحالية", visualTransformation = PasswordVisualTransformation())
                AppField(next, { next = it }, "كلمة المرور الجديدة", visualTransformation = PasswordVisualTransformation())
                AppField(confirm, { confirm = it }, "تأكيد كلمة المرور", visualTransformation = PasswordVisualTransformation())
                Row(verticalAlignment = Alignment.CenterVertically) { Switch(signOutAll, { signOutAll = it }); Text("تسجيل الخروج من جميع الأجهزة") }
            }
        },
        confirmButton = { TextButton(enabled = !state.busy, onClick = { viewModel.changePassword(current, next, confirm, signOutAll); onDismiss() }) { Text("حفظ") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
private fun DeleteAccountDialog(state: MainUiState, viewModel: AppViewModel, onDismiss: () -> Unit) {
    var password by remember { mutableStateOf("") }
    var phrase by remember { mutableStateOf("") }
    val info = state.accountDeletion
    val request = info?.request
    val canConfirm = phrase.trim() == "حذف حسابي" && password.isNotBlank() && !state.busy &&
        !state.accountDeletionLoading
    LaunchedEffect(state.snapshot?.userId) { viewModel.loadAccountDeletionStatus() }
    AlertDialog(
        onDismissRequest = { if (!state.busy) onDismiss() },
        title = { Text("طلب حذف الحساب") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("يمكنك تقديم طلب حذف الحساب وبياناته الآن، حتى عند وجود طرود نشطة أو فواتير مستحقة. تقديم الطلب لا يحذف الفواتير ولا يُسقط المستحقات، ولا يلزم الاتصال بالدعم لبدء الطلب.")
                if (state.accountDeletionLoading) Text("جارٍ تحميل حالة الطلب والتزامات الحساب…")
                if (state.offlineCache && info == null) Text("اتصل بالإنترنت لتحديث الحالة وتقديم الطلب.", color = MaterialTheme.colorScheme.error)
                state.accountDeletionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (info != null) {
                    Text(info.reviewTimeline, style = MaterialTheme.typography.bodySmall)
                    Text(info.retentionNotice, style = MaterialTheme.typography.bodySmall)
                    if (!info.eligible) Text(
                        "التزامات تحتاج تسوية: ${info.activeOrderCount} طرد نشط، ${info.unsettledCollectionCount} فاتورة غير مسددة، ${info.unsettledOrderCount} طرد غير مسوّى. لا تمنع هذه الالتزامات تسجيل طلب الحذف.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (request != null) {
                    Text(request.statusLabel, fontWeight = FontWeight.Bold)
                    SelectionContainer { Text("رقم الطلب: ${request.id}") }
                    Text("تاريخ الطلب: ${displayDate(request.createdAt)}", style = MaterialTheme.typography.bodySmall)
                    Text("موعد المراجعة: ${displayDate(request.reviewDueAt)}", style = MaterialTheme.typography.bodySmall)
                    Text("آخر تحديث: ${displayDate(request.updatedAt)}", style = MaterialTheme.typography.bodySmall)
                    Text(request.message)
                    safeDeletionReceiptUrl(request.receiptUrl, PUBLIC_WEBSITE_ORIGIN)?.let { receipt ->
                        ExternalWebsiteLink("فتح رابط المتابعة وحفظه", receipt)
                        Text("احتفظ برابط المتابعة لنفسك؛ يبقى متاحًا بعد حذف الحساب.", style = MaterialTheme.typography.bodySmall)
                    }
                }
                TextButton(enabled = !state.busy && !state.accountDeletionLoading, onClick = viewModel::loadAccountDeletionStatus) { Text("تحديث حالة الطلب") }
                if (request == null || info?.eligible == true) {
                    AppField(password, { password = it }, "كلمة المرور الحالية", visualTransformation = PasswordVisualTransformation(), enabled = !state.busy)
                    AppField(phrase, { phrase = it }, "اكتب: حذف حسابي", enabled = !state.busy)
                }
                if (info?.eligible == true) {
                    Text("اكتملت التسوية حسب آخر تحديث. يمكنك بدل الانتظار حذف الحساب وبياناته فورًا؛ الحذف النهائي لا يمكن التراجع عنه.", style = MaterialTheme.typography.bodySmall)
                    TextButton(enabled = canConfirm, onClick = { viewModel.deleteOwnAccount(password) }) {
                        Text("حذف حسابي وبياناتي الآن", color = MaterialTheme.colorScheme.error)
                    }
                }
                PublicWebsiteLink("طلب الحذف من الموقع دون التطبيق", "/delete-account")
                PublicWebsiteLink("التواصل مع الدعم", "/support")
            }
        },
        confirmButton = {
            if (request == null) TextButton(enabled = canConfirm && info != null, onClick = {
                viewModel.requestOwnAccountDeletion(password) { password = ""; phrase = "" }
            }) { Text(if (state.busy) "جارٍ إرسال الطلب…" else "تقديم طلب حذف الحساب") }
        },
        dismissButton = { TextButton(enabled = !state.busy, onClick = onDismiss) { Text("إغلاق") } },
    )
}

@Composable
fun ProfileScreen(state: MainUiState, viewModel: AppViewModel, onBack: () -> Unit) {
    val user = state.snapshot?.currentUser ?: return
    val editable = user.role == Role.ADMIN
    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var phone by rememberSaveable(user.id) { mutableStateOf(user.phone) }
    var email by rememberSaveable(user.id) { mutableStateOf(user.email) }
    var store by rememberSaveable(user.id) { mutableStateOf(user.store) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ScreenHeader("الملف الشخصي", if (editable) "تعديل معلومات حساب المسؤول" else "معلومات الحساب للعرض", onBack) }
        item {
            SectionCard {
                Text(user.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                Text(user.email)
                Text("عضو منذ ${displayDate(user.joinedAt)}", style = MaterialTheme.typography.bodySmall)
            }
        }
        item {
            SectionCard(title = "بيانات الحساب") {
                AppField(name, { name = it }, "الاسم", enabled = editable)
                AppField(phone, { phone = it.filter(Char::isDigit).take(10) }, "رقم الجوال", enabled = editable)
                AppField(store, { store = it }, if (user.role == Role.COURIER) "الاسم" else "اسم المتجر", enabled = editable)
                AppField(email, { email = it }, "البريد الإلكتروني", enabled = editable)
                if (editable) PrimaryButton("حفظ التغييرات", { viewModel.broadcastAccountProfile(name, phone, email, store) }, busy = state.busy)
            }
        }
    }
}
