package com.almadinaexpress.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.displayDate

@Composable
fun ParcelCodeBatchesScreen(state: MainUiState, viewModel: AppViewModel, onBack: () -> Unit) {
    val snapshot = state.snapshot ?: return
    if (snapshot.currentUser?.role != Role.ADMIN) {
        EmptyState("غير متاح", "حجز أكواد الطرود وطباعتها متاح لحساب الإدارة فقط.")
        return
    }
    val context = LocalContext.current
    var count by rememberSaveable { mutableStateOf("50") }
    var label by rememberSaveable { mutableStateOf("") }
    var unusedOnly by rememberSaveable { mutableStateOf(true) }
    var generatedBatchId by rememberSaveable { mutableStateOf<String?>(null) }
    val hasPendingRequest = state.parcelCodePendingCount != null
    val batches = snapshot.parcelCodeBatches.sortedByDescending { it.createdAt }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ScreenHeader("أكواد الطرود للطباعة", "احجز الأكواد واطبع الملصقات لتوزيعها على الزبائن", onBack) }
        item {
            SectionCard(title = "دفعة أكواد جديدة") {
                AppField(
                    state.parcelCodePendingCount?.toString() ?: count,
                    { count = it.mapNotNull(Char::digitToIntOrNull).joinToString("").take(3) },
                    "عدد الأكواد (1–500)",
                    enabled = !state.busy && !hasPendingRequest,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                AppField(
                    state.parcelCodePendingLabel ?: label,
                    { label = it.take(80) },
                    "اسم الدفعة (اختياري)",
                    enabled = !state.busy && !hasPendingRequest,
                    placeholder = "مثال: ملصقات فرع نابلس",
                )
                Text("يُحجز كل كود مرة واحدة، ثم يقرأ الزبون رمز QR بالكاميرا من تفاصيل الطرد. حجز الأكواد لا يُنشئ طرودًا فعلية.", style = MaterialTheme.typography.bodySmall)
                if (hasPendingRequest && !state.busy) {
                    Text("لم يصل تأكيد الطلب السابق. أعد المحاولة لاستعادة الدفعة نفسها دون إنشاء دفعة مكررة.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
                PrimaryButton(
                    if (hasPendingRequest) "إعادة محاولة حجز الدفعة" else "حجز أكواد جديدة",
                    {
                        viewModel.createParcelCodeBatch(count.toIntOrNull() ?: 0, label) { batch ->
                            generatedBatchId = batch.id
                        }
                    },
                    icon = Icons.Outlined.Add,
                    busy = state.busy,
                )
            }
        }
        item {
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("طباعة الأكواد غير المستخدمة فقط", Modifier.weight(1f), fontWeight = FontWeight.Bold)
                    Switch(checked = unusedOnly, onCheckedChange = { unusedOnly = it }, enabled = !state.busy)
                }
                Text(
                    if (unusedOnly) "تُحدّث حالة الأكواد قبل الطباعة. الورقة A4 وتحتوي على 24 ملصقًا مع رمز QR والكود المقروء."
                    else "ستُعاد طباعة جميع أكواد الدفعة، بما فيها الأكواد المرتبطة بطرود. لا توزّع الكود نفسه على أكثر من زبون.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (batches.isEmpty()) {
            item { EmptyState("لا توجد دفعات أكواد", "احجز الدفعة الأولى لتجهيز الملصقات للزبائن.") }
        }
        items(batches, key = { it.id }) { batch ->
            val unusedCount = batch.codes.count { it !in snapshot.claimedParcelCodes }
            SectionCard(title = batch.label.ifBlank { "دفعة أكواد الطرود" }) {
                if (batch.id == generatedBatchId) Text("تم حجز هذه الدفعة", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("${batch.codes.first()} — ${batch.codes.last()}", fontWeight = FontWeight.Bold)
                Text("${batch.count} كود • $unusedCount غير مستخدم • ${displayDate(batch.createdAt)}", style = MaterialTheme.typography.bodySmall)
                PrimaryButton(
                    if (unusedOnly) "طباعة $unusedCount كود غير مستخدم" else "إعادة طباعة الدفعة كاملة",
                    {
                        viewModel.prepareParcelCodePrint(batch.id, unusedOnly) { confirmedBatch, codes ->
                            printParcelCodes(context, codes, confirmedBatch.label.ifBlank { "أكواد الطرود" })
                        }
                    },
                    icon = Icons.Outlined.Print,
                    busy = state.busy,
                    enabled = !unusedOnly || unusedCount > 0,
                )
            }
        }
        item { Spacer(Modifier.height(30.dp)) }
    }
}
