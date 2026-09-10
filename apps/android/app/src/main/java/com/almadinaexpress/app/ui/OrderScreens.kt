package com.almadinaexpress.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.unit.dp
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.NewOrderInput
import com.almadinaexpress.app.data.DeliveryZone
import com.almadinaexpress.app.data.OrderPricing
import com.almadinaexpress.app.data.OrderStatus
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.displayDate
import com.almadinaexpress.app.data.displayMoney
import com.almadinaexpress.app.data.isValidParcelCode
import com.almadinaexpress.app.data.normalizeParcelCode
import com.almadinaexpress.app.data.newId
import com.almadinaexpress.app.data.orderPricing
import com.almadinaexpress.app.data.oversizeSurcharge
import com.almadinaexpress.app.data.string
import kotlin.math.max

private data class ParcelTypeOption(val title: String, val description: String)

private val parcelTypeOptions = listOf(
    ParcelTypeOption("طرد عادي", "توصيل منتج وتحصيل المبلغ"),
    ParcelTypeOption("طرد تبديل", "استلام القديم وتسليم البديل"),
    ParcelTypeOption("تجربة أو شراء", "معاينة المنتج والدفع عند الاستلام"),
    ParcelTypeOption("رجوع", "استلام بضاعة وإعادتها إلى المرسل"),
)

private fun dimensionInput(value: String): String = buildString {
    var hasDecimalSeparator = false
    var integerDigits = 0
    var decimalDigits = 0
    value.forEach { character ->
        val digit = character.digitToIntOrNull()
        when {
            digit != null && !hasDecimalSeparator && integerDigits < 3 -> {
                append(digit)
                integerDigits += 1
            }
            digit != null && hasDecimalSeparator && decimalDigits < 2 -> {
                append(digit)
                decimalDigits += 1
            }
            (character == '.' || character == '٫' || character == ',') && !hasDecimalSeparator -> {
                append('.')
                hasDecimalSeparator = true
            }
        }
    }
}

@Composable
fun NewOrderScreen(state: MainUiState, viewModel: AppViewModel, onBack: () -> Unit, onDone: (String) -> Unit) {
    val user = state.snapshot?.currentUser ?: return
    if (user.role != Role.MERCHANT) {
        EmptyState("غير متاح", "إنشاء طرد جديد متاح لحساب المستخدم فقط.")
        return
    }
    val orderId = rememberSaveable { newId("order") }
    var parcelType by rememberSaveable { mutableStateOf(parcelTypeOptions.first().title) }
    var recipientName by rememberSaveable { mutableStateOf("") }
    var recipientPhone by rememberSaveable { mutableStateOf("") }
    var deliveryZoneName by rememberSaveable { mutableStateOf("") }
    var city by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var amount by rememberSaveable { mutableStateOf("") }
    var content by rememberSaveable { mutableStateOf("") }
    var weight by rememberSaveable { mutableStateOf("0 - 5 كغم") }
    var length by rememberSaveable { mutableStateOf("") }
    var width by rememberSaveable { mutableStateOf("") }
    var height by rememberSaveable { mutableStateOf("") }
    var instructions by rememberSaveable { mutableStateOf("") }
    var privateNote by rememberSaveable { mutableStateOf("") }
    var reference by rememberSaveable { mutableStateOf("") }
    var weightMenu by remember { mutableStateOf(false) }
    val selectedZone = DeliveryZone.entries.firstOrNull { it.name == deliveryZoneName }
    val lengthValue = length.toDoubleOrNull()
    val widthValue = width.toDoubleOrNull()
    val heightValue = height.toDoubleOrNull()
    val dimensionFee = oversizeSurcharge(lengthValue, widthValue, heightValue)
    val pricing = selectedZone?.let { orderPricing(user.membership, it, weight, lengthValue, widthValue, heightValue) }
        ?: OrderPricing(0.0, 0.0, 0.0)
    val parcelPrice = amount.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0
    val valueAfterDelivery = max(parcelPrice - pricing.deliveryFee, 0.0)
    val pickupAddress = user.raw.string("address").ifBlank { user.store }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ScreenHeader("إنشاء طرد جديد", "أدخل بيانات المستلم والطرد", onBack) }
        item {
            SectionCard(title = "نوع الطرد") {
                parcelTypeOptions.chunked(2).forEach { row ->
                    AdaptiveItemRow(itemCount = row.size, stackBelow = 520.dp) { index, itemModifier ->
                        val option = row[index]
                        FilterChip(
                            selected = parcelType == option.title,
                            onClick = { parcelType = option.title },
                            label = {
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(option.title, fontWeight = FontWeight.Bold)
                                    Text(option.description, style = MaterialTheme.typography.labelSmall)
                                }
                            },
                            modifier = itemModifier.heightIn(min = 58.dp),
                        )
                    }
                }
            }
        }
        item {
            SectionCard(title = "بيانات المستلم") {
                AppField(recipientName, { recipientName = it }, "اسم المستلم")
                AppField(recipientPhone, { recipientPhone = it.filter(Char::isDigit).take(10) }, "رقم الجوال 05xxxxxxxx")
                Text("نطاق التوصيل", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                AdaptiveItemRow(itemCount = DeliveryZone.entries.size, stackBelow = 400.dp) { index, itemModifier ->
                    val zone = DeliveryZone.entries[index]
                        FilterChip(
                            selected = selectedZone == zone,
                            onClick = { deliveryZoneName = zone.name },
                            label = { Text(if (zone == DeliveryZone.WEST_BANK) "الضفة" else zone.arabic) },
                            modifier = itemModifier,
                        )
                }
                AppField(city, { city = it }, "المنطقة / المدينة")
                AppField(address, { address = it }, "الشارع / وصف العنوان")
            }
        }
        item {
            SectionCard(title = "تفاصيل الطرد") {
                AppField(amount, { amount = it.filter { ch -> ch.isDigit() || ch == '.' } }, "سعر الطرد ₪")
                AppField(
                    displayMoney(valueAfterDelivery),
                    {},
                    "قيمة المحتويات بعد خصم التوصيل ₪",
                    readOnly = true,
                )
                Text(
                    if (selectedZone == null) "اختر نطاق التوصيل لحساب الخصم بدقة."
                    else "${displayMoney(parcelPrice)} − ${displayMoney(pricing.deliveryFee)} = ${displayMoney(valueAfterDelivery)} ₪",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selectedZone == null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                AppField(content, { content = it }, "وصف المحتوى", singleLine = false, minLines = 2)
                Column {
                    OutlinedButton(onClick = { weightMenu = true }, Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(18.dp)) { Text(weight) }
                    DropdownMenu(expanded = weightMenu, onDismissRequest = { weightMenu = false }) {
                        listOf("0 - 5 كغم", "5 - 10 كغم", "10 - 20 كغم", "20 - 30 كغم", "أكثر من 30 كغم").forEach { value ->
                            DropdownMenuItem(text = { Text(value) }, onClick = { weight = value; weightMenu = false })
                        }
                    }
                }
                Text("الأبعاد اختيارية بالسنتيمتر", style = MaterialTheme.typography.labelLarge)
                AdaptiveItemRow(itemCount = 3, stackBelow = 520.dp) { index, itemModifier ->
                    when (index) {
                        0 -> AppField(length, { length = dimensionInput(it) }, "الطول", itemModifier)
                        1 -> AppField(width, { width = dimensionInput(it) }, "العرض", itemModifier)
                        else -> AppField(height, { height = dimensionInput(it) }, "الارتفاع", itemModifier)
                    }
                }
                Text(
                    if (dimensionFee > 0) "رسوم الأبعاد الحالية ${displayMoney(dimensionFee)} ₪؛ بعد 40 سم يُضاف 7 ₪ لكل 20 سم أو جزء منها، بحد أقصى 28 ₪ لكل بُعد." + if (selectedZone == null) " اختر نطاق التوصيل لإضافتها إلى الإجمالي." else ""
                    else "حتى 40 سم لكل بُعد دون رسوم حجم إضافية.",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (dimensionFee > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                AppField(reference, { reference = it }, "رقم المرجع (اختياري)")
            }
        }
        item {
            SectionCard(title = "التعليمات والملاحظات") {
                AppField(instructions, { instructions = it.take(500) }, "التعليمات — تظهر للمندوب", singleLine = false, minLines = 3)
                AppField(privateNote, { privateNote = it.take(1000) }, "الملاحظة الخاصة — تظهر للمسؤول فقط", singleLine = false, minLines = 3)
            }
        }
        item {
            SectionCard(title = "المحاسبة") {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.AccountBalanceWallet, null, tint = MaterialTheme.colorScheme.primary)
                    Text("الأسعار حسب حساب ${user.membership.arabic}", fontWeight = FontWeight.Bold)
                }
                AccountingLine("نطاق التوصيل", selectedZone?.arabic ?: "غير محدد")
                AccountingLine("رسوم المنطقة", "${displayMoney(pricing.baseFee)} ₪")
                if (pricing.weightFee > 0) AccountingLine("رسوم الوزن", "${displayMoney(pricing.weightFee)} ₪")
                if (pricing.oversizeFee > 0) AccountingLine("رسوم الحجم الإضافية", "${displayMoney(pricing.oversizeFee)} ₪")
                AccountingLine("إجمالي رسوم التوصيل", "${displayMoney(pricing.deliveryFee)} ₪", strong = true)
                AccountingLine("سعر الطرد", "${displayMoney(parcelPrice)} ₪")
                AccountingLine("قيمة المحتويات بعد الخصم", "${displayMoney(valueAfterDelivery)} ₪", strong = true)
            }
        }
        item {
            PrimaryButton("إنشاء الطرد", {
                val zone = selectedZone
                viewModel.createOrder(
                    NewOrderInput(
                        type = parcelType,
                        recipientName = recipientName.trim(),
                        recipientPhone = recipientPhone,
                        governorate = zone?.storedGovernorate.orEmpty(),
                        city = city.trim(),
                        address = address.trim(),
                        pickupAddress = pickupAddress,
                        amount = amount.toDoubleOrNull() ?: -1.0,
                        content = content.trim(),
                        weight = weight,
                        lengthCm = lengthValue,
                        widthCm = widthValue,
                        heightCm = heightValue,
                        instructions = instructions.trim(),
                        privateNote = privateNote.trim(),
                        reference = reference.trim(),
                    ),
                    orderId,
                    onDone,
                )
            }, icon = Icons.Outlined.LocalShipping, busy = state.busy)
        }
        item { Spacer(Modifier.height(100.dp)) }
    }
}

@Composable
private fun AccountingLine(label: String, value: String, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, Modifier.weight(1f), fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal)
        Text(value, fontWeight = if (strong) FontWeight.ExtraBold else FontWeight.Bold)
    }
}

@Composable
fun OrderDetailScreen(state: MainUiState, viewModel: AppViewModel, orderId: String?, onScanCode: ((String) -> Unit) -> Unit, onBack: () -> Unit) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    val order = snapshot.orders.firstOrNull { it.id == orderId }
    if (order == null) {
        EmptyState("الطرد غير موجود", "ربما حُذف أو تغيّرت بياناته.", "العودة للطرود", onBack)
        return
    }
    var note by rememberSaveable(order.id) { mutableStateOf("") }
    var statusDialog by remember { mutableStateOf<OrderStatus?>(null) }
    var statusNote by rememberSaveable { mutableStateOf("") }
    var deleteConfirm by remember { mutableStateOf(false) }
    var qrVisible by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var scannedParcelCode by rememberSaveable(order.id) { mutableStateOf("") }
    val hasCode = order.trackingNumber.isNotBlank()
    val canAssignCode = !hasCode && !order.deleted &&
        (user.role == Role.ADMIN || (user.role == Role.MERCHANT && order.merchantId == user.id))
    val context = LocalContext.current

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ScreenHeader("تفاصيل الطرد", order.trackingNumber.ifBlank { "بانتظار إضافة كود QR" }, onBack) }
        item {
            SectionCard(title = "كود الطرد") {
                if (canAssignCode) {
                    Text("امسح بالكاميرا رمز QR الموجود على ملصق الشركة. سيُضاف الكود لهذا الطرد تلقائيًا بعد التحقق منه.", style = MaterialTheme.typography.bodySmall)
                    PrimaryButton(
                        if (scannedParcelCode.isBlank()) "إضافة كود QR" else "قراءة QR آخر",
                        {
                            onScanCode { value ->
                                val code = normalizeParcelCode(value)
                                if (isValidParcelCode(code)) {
                                    scannedParcelCode = code
                                    viewModel.assignParcelCode(order.id, code) { scannedParcelCode = "" }
                                } else {
                                    viewModel.reportScannerError("هذا الرمز ليس كود طرد صالحًا. امسح ملصق الشركة.")
                                }
                            }
                        },
                        icon = Icons.Outlined.QrCodeScanner,
                        busy = state.busy,
                    )
                    if (scannedParcelCode.isNotBlank()) {
                        Text(scannedParcelCode, Modifier.fillMaxWidth(), textAlign = TextAlign.Center, fontWeight = FontWeight.Bold)
                        TextButton(
                            onClick = { viewModel.assignParcelCode(order.id, scannedParcelCode) { scannedParcelCode = "" } },
                            enabled = !state.busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("إعادة محاولة الحفظ") }
                    }
                } else {
                    Text(
                        order.trackingNumber.ifBlank { "بانتظار إضافة كود QR" },
                        Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                        textAlign = TextAlign.Center,
                    )
                }
                AdaptiveItemRow(itemCount = 2, stackBelow = 340.dp, spacing = 10.dp) { index, itemModifier ->
                    if (index == 0) {
                        OutlinedButton(
                            onClick = {
                                copyText(context, "رقم الطرد", order.trackingNumber)
                                copied = true
                            },
                            enabled = hasCode,
                            modifier = itemModifier.heightIn(min = 50.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Icon(Icons.Outlined.ContentCopy, null, Modifier.size(20.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("نسخ الرقم")
                        }
                    } else {
                        OutlinedButton(
                            onClick = { qrVisible = true },
                            enabled = hasCode,
                            modifier = itemModifier.heightIn(min = 50.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Icon(Icons.Outlined.QrCode2, null, Modifier.size(21.dp))
                            Spacer(Modifier.size(6.dp))
                            Text("إظهار QR")
                        }
                    }
                }
                if (copied) Text("تم نسخ رقم الطرد.", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
            }
        }
        item {
            SectionCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusPill(order.status)
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                        Text(order.recipientName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Text(order.recipientPhone)
                    }
                }
                Text("${order.governorate} · ${order.city} · ${order.address}")
                Text("المندوب: ${order.courierName}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            SectionCard(title = "المبالغ") {
                AccountingLine("سعر الطرد", "${displayMoney(order.amount)} ₪")
                val baseFee = max(order.deliveryFee - order.weightFee - order.oversizeFee, 0.0)
                AccountingLine("رسوم المنطقة", "${displayMoney(baseFee)} ₪")
                if (order.weightFee > 0) AccountingLine("رسوم الوزن", "${displayMoney(order.weightFee)} ₪")
                if (order.oversizeFee > 0) AccountingLine("رسوم الحجم الإضافية", "${displayMoney(order.oversizeFee)} ₪")
                AccountingLine("إجمالي رسوم التوصيل", "${displayMoney(order.deliveryFee)} ₪", strong = true)
                AccountingLine("قيمة المحتويات بعد خصم التوصيل", "${displayMoney(max(order.amount - order.deliveryFee, 0.0))} ₪", strong = true)
            }
        }
        if (order.content.isNotBlank()) item { SectionCard(title = "وصف المحتوى") { Text(order.content) } }
        if (order.notes.isNotBlank() || order.privateNotes.isNotBlank()) item {
            SectionCard(title = "تعليمات الطرد") {
                if (order.notes.isNotBlank()) Text("للمندوب: ${order.notes}")
                if (user.role == Role.ADMIN && order.privateNotes.isNotBlank()) Text("ملاحظة خاصة: ${order.privateNotes}", color = MaterialTheme.colorScheme.error)
            }
        }
        if (user.role == Role.ADMIN) item {
            SectionCard(title = "تحديث حالة الطرد") {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OrderStatus.entries.forEach { status ->
                        FilterChip(
                            selected = status == (statusDialog ?: order.status),
                            onClick = { if (status != order.status) statusDialog = status },
                            label = { Text(status.arabic) },
                        )
                    }
                }
                Text("عند حفظ الحالة أو كتابة ملاحظة سيصل إشعار للمستخدم ويفتح هذا الطرد عند النقر عليه.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (user.role != Role.COURIER) item {
            SectionCard(title = "إضافة ملاحظة للحالة الحالية") {
                AppField(note, { note = it.take(500) }, "نص الملاحظة", singleLine = false, minLines = 3)
                PrimaryButton("حفظ الملاحظة وإرسال إشعار", { viewModel.addOrderNote(order, note) { note = "" } }, icon = Icons.Outlined.EditNote, busy = state.busy)
            }
        }
        item { Text("سجل التتبع", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold) }
        if (order.events.isEmpty()) item { EmptyState("لا يوجد سجل", "ستظهر تحديثات الحالة هنا.") }
        else items(order.events.sortedByDescending { it.createdAt }, key = { it.id }) { event ->
            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .3f)),
            ) {
                Row(Modifier.fillMaxWidth().padding(15.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.Timeline, null, tint = Color(event.status.color))
                    Column(Modifier.weight(1f)) {
                        Text(if (event.kind == "note") "ملاحظة مضافة" else event.status.arabic, fontWeight = FontWeight.Bold)
                        if (event.note.isNotBlank()) Text(event.note)
                        Text("${event.actor} · ${displayDate(event.createdAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (user.role != Role.COURIER) {
            item {
                OutlinedButton(onClick = { deleteConfirm = true }, Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(18.dp)) {
                    Icon(Icons.Outlined.DeleteOutline, null); Text("نقل الطرد إلى المحذوفات")
                }
            }
        }
        item { Spacer(Modifier.height(100.dp)) }
    }

    statusDialog?.let { selected ->
        AlertDialog(
            onDismissRequest = { statusDialog = null },
            title = { Text("تحديث الحالة إلى «${selected.arabic}»") },
            text = { AppField(statusNote, { statusNote = it.take(500) }, "ملاحظة الحالة (اختياري)", singleLine = false, minLines = 3) },
            confirmButton = { TextButton(onClick = { viewModel.updateOrderStatus(order, selected, statusNote) { statusDialog = null; statusNote = "" } }) { Text("حفظ وإشعار المستخدم") } },
            dismissButton = { TextButton(onClick = { statusDialog = null }) { Text("إلغاء") } },
        )
    }
    if (deleteConfirm) AlertDialog(
        onDismissRequest = { deleteConfirm = false },
        title = { Text("حذف الطرد؟") },
        text = { Text("سينتقل الطرد إلى المحذوفات ويمكن استعادته خلال 30 يومًا، ثم يُحذف نهائيًا.") },
        confirmButton = { TextButton(onClick = { viewModel.moveOrderToTrash(order.id) { deleteConfirm = false; onBack() } }) { Text("حذف") } },
        dismissButton = { TextButton(onClick = { deleteConfirm = false }) { Text("إلغاء") } },
    )
    if (qrVisible && hasCode) AlertDialog(
        onDismissRequest = { qrVisible = false },
        title = { Text("رمز QR للطرد") },
        text = {
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val bitmap = remember(order.trackingNumber) { createQrBitmap(order.trackingNumber, 640) }
                Image(bitmap.asImageBitmap(), "رمز QR للطرد ${order.trackingNumber}", Modifier.size(230.dp))
                Text(order.trackingNumber, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
                Text("يمكن للمندوب قراءة الرمز مباشرة من الشاشة.", textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = { qrVisible = false }) { Text("إغلاق") } },
    )
}

private fun copyText(context: Context, label: String, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
}
