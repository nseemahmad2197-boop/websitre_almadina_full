package com.almadinaexpress.app.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.SupervisorAccount
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.Membership
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.UserItem

@Composable
fun UsersScreen(state: MainUiState, viewModel: AppViewModel) {
    val snapshot = state.snapshot ?: return
    if (snapshot.currentUser?.role != Role.ADMIN) {
        EmptyState("غير متاح", "إدارة الحسابات متاحة للمسؤول فقط.")
        return
    }
    var addOpen by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<UserItem?>(null) }
    var editTarget by remember { mutableStateOf<UserItem?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    val users = snapshot.users.filter { query.isBlank() || it.name.contains(query, true) || it.email.contains(query, true) || it.phone.contains(query) }

    androidx.compose.foundation.layout.Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            item { ScreenHeader("الحسابات", "إدارة المستخدمين والمندوبين") }
            item { AppField(query, { query = it }, "بحث بالاسم أو البريد أو الجوال") }
            items(users, key = { it.id }) { user ->
                Card(
                    Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .3f)),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Row {
                                IconButton(onClick = { editTarget = user }) { Icon(Icons.Outlined.Edit, "تعديل الحساب") }
                                if (user.role != Role.ADMIN) IconButton(onClick = { deleteTarget = user }) { Icon(Icons.Outlined.DeleteOutline, "حذف الحساب", tint = MaterialTheme.colorScheme.error) }
                            }
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                                Text(user.name, fontWeight = FontWeight.ExtraBold)
                                Text(user.email, style = MaterialTheme.typography.bodySmall)
                                Text("${user.phone} · ${roleLabel(user.role)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Icon(Icons.Outlined.SupervisorAccount, null, tint = MaterialTheme.colorScheme.primary)
                        }
                        if (user.role == Role.MERCHANT) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Membership.entries.forEach { membership ->
                                    OutlinedButton(
                                        onClick = { viewModel.updateMembership(user.id, membership) },
                                        modifier = Modifier.weight(1f),
                                        enabled = membership != user.membership && !state.busy,
                                    ) { Text(membership.arabic) }
                                }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(96.dp)) }
        }
        FloatingActionButton(onClick = { addOpen = true }, Modifier.align(Alignment.BottomStart).padding(24.dp)) { Icon(Icons.Outlined.PersonAdd, "إضافة حساب") }
    }

    if (addOpen) AddAccountDialog(state, viewModel) { addOpen = false }
    editTarget?.let { target -> EditAccountDialog(state, viewModel, target) { editTarget = null } }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("حذف حساب ${target.name}؟") },
            text = { Text("سيُحذف الحساب من النظام. لا يمكن حذف حساب المسؤول الحالي.") },
            confirmButton = { TextButton(onClick = { viewModel.deleteAccountByAdmin(target.id); deleteTarget = null }) { Text("حذف الحساب") } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun EditAccountDialog(state: MainUiState, viewModel: AppViewModel, user: UserItem, onDismiss: () -> Unit) {
    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var phone by rememberSaveable(user.id) { mutableStateOf(user.phone) }
    var email by rememberSaveable(user.id) { mutableStateOf(user.email) }
    var store by rememberSaveable(user.id) { mutableStateOf(if (user.role == Role.COURIER) user.name else user.store) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تعديل معلومات ${user.name}") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 500.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                AppField(name, {
                    name = it
                    if (user.role == Role.COURIER) store = it
                }, "الاسم")
                AppField(phone, { phone = it.filter(Char::isDigit).take(10) }, "رقم الجوال")
                AppField(email, { email = it }, "البريد الإلكتروني")
                if (user.role == Role.MERCHANT) AppField(store, { store = it }, "اسم المتجر")
                if (user.role == Role.COURIER) Text("يُستخدم حقل الاسم للمندوب أو الموظف، ولا يوجد حقل منطقة.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !state.busy,
                onClick = { viewModel.updateAccountByAdmin(user.id, name, phone, email, store, onDismiss) },
            ) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
private fun AddAccountDialog(state: MainUiState, viewModel: AppViewModel, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf(Role.COURIER) }
    var membership by rememberSaveable { mutableStateOf(Membership.STANDARD) }
    var roleMenu by remember { mutableStateOf(false) }
    var membershipMenu by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إضافة حساب جديد") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                OutlinedButton(onClick = { roleMenu = true }, Modifier.fillMaxWidth()) { Text(roleLabel(role)) }
                DropdownMenu(expanded = roleMenu, onDismissRequest = { roleMenu = false }) {
                    DropdownMenuItem(text = { Text("مندوب / موظف") }, onClick = { role = Role.COURIER; roleMenu = false })
                    DropdownMenuItem(text = { Text("مستخدم / تاجر") }, onClick = { role = Role.MERCHANT; roleMenu = false })
                }
                AppField(name, { name = it }, "الاسم")
                AppField(phone, { phone = it.filter(Char::isDigit).take(10) }, "رقم الجوال")
                AppField(email, { email = it }, "البريد الإلكتروني")
                AppField(password, { password = it }, "كلمة المرور", visualTransformation = PasswordVisualTransformation())
                if (role == Role.MERCHANT) {
                    OutlinedButton(onClick = { membershipMenu = true }, Modifier.fillMaxWidth()) { Text("نوع الحساب: ${membership.arabic}") }
                    DropdownMenu(expanded = membershipMenu, onDismissRequest = { membershipMenu = false }) {
                        Membership.entries.forEach { item -> DropdownMenuItem(text = { Text(item.arabic) }, onClick = { membership = item; membershipMenu = false }) }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !state.busy, onClick = { viewModel.addAccount(name, phone, email, password, role, membership, onDismiss) }) { Text("إضافة") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
fun BroadcastScreen(state: MainUiState, viewModel: AppViewModel) {
    val snapshot = state.snapshot ?: return
    if (snapshot.currentUser?.role != Role.ADMIN) {
        EmptyState("غير متاح", "إرسال التحديثات متاح للمسؤول فقط.")
        return
    }
    var audience by rememberSaveable { mutableStateOf("all") }
    var recipientId by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("") }
    var audienceMenu by remember { mutableStateOf(false) }
    var userMenu by remember { mutableStateOf(false) }
    val audiences = listOf(
        "all" to "جميع الحسابات", "merchants" to "المستخدمون", "couriers" to "المندوبون والموظفون",
        "standard" to "الحساب العادي", "premium" to "الحساب البريميوم", "diamond" to "الحساب الماسي", "user" to "مستخدم محدد",
    )
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ScreenHeader("إرسال تحديث", "سيظهر كإشعار أصلي داخل التطبيق") }
        item {
            SectionCard(title = "المستلمون") {
                OutlinedButton(onClick = { audienceMenu = true }, Modifier.fillMaxWidth().height(54.dp)) { Text(audiences.first { it.first == audience }.second) }
                DropdownMenu(expanded = audienceMenu, onDismissRequest = { audienceMenu = false }) {
                    audiences.forEach { (id, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { audience = id; recipientId = null; audienceMenu = false }) }
                }
                if (audience == "user") {
                    val users = snapshot.users.filter { it.role != Role.ADMIN }
                    OutlinedButton(onClick = { userMenu = true }, Modifier.fillMaxWidth().height(54.dp)) { Text(users.firstOrNull { it.id == recipientId }?.name ?: "اختر المستخدم") }
                    DropdownMenu(expanded = userMenu, onDismissRequest = { userMenu = false }) {
                        users.forEach { user -> DropdownMenuItem(text = { Text("${user.name} · ${user.email}") }, onClick = { recipientId = user.id; userMenu = false }) }
                    }
                }
            }
        }
        item {
            SectionCard(title = "محتوى الإشعار") {
                AppField(title, { title = it.take(80) }, "العنوان")
                AppField(message, { message = it.take(500) }, "التفاصيل", singleLine = false, minLines = 5)
                PrimaryButton("إرسال الإشعار", {
                    viewModel.broadcast(audience, recipientId, title, message) { title = ""; message = "" }
                }, icon = Icons.AutoMirrored.Outlined.Send, busy = state.busy, enabled = audience != "user" || recipientId != null)
            }
        }
    }
}

private fun roleLabel(role: Role) = when (role) {
    Role.ADMIN -> "مسؤول"
    Role.COURIER -> "مندوب / موظف"
    Role.MERCHANT -> "مستخدم / تاجر"
}
