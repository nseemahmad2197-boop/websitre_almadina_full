package com.almadinaexpress.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.CollectionItem
import com.almadinaexpress.app.data.OrderStatus
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.displayDate
import com.almadinaexpress.app.data.displayMoney
import com.almadinaexpress.app.data.isOrderInvoicedForCurrentShipment
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix
import androidx.core.graphics.createBitmap

@Composable
fun CollectionsScreen(state: MainUiState, viewModel: AppViewModel) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    var merchantFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<CollectionItem?>(null) }
    var verifying by remember { mutableStateOf<CollectionItem?>(null) }
    var code by remember { mutableStateOf("") }
    var createConfirm by remember { mutableStateOf(false) }
    val eligible = snapshot.orders.filter {
        !it.deleted &&
            !isOrderInvoicedForCurrentShipment(it, snapshot.collections) &&
            it.status in listOf(OrderStatus.DELIVERED, OrderStatus.RETURNED) &&
            (user.role != Role.MERCHANT || it.merchantId == user.id)
    }
    val visible = snapshot.visibleCollections.filter { merchantFilter == null || it.merchantId == merchantFilter }.sortedByDescending { it.createdAt }
    val merchants = snapshot.users.filter { it.role == Role.MERCHANT }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ScreenHeader("التحصيلات", "الفواتير متزامنة مع قاعدة الموقع") }
        if (user.role == Role.ADMIN && merchants.isNotEmpty()) item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("حسابات المستخدمين", fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(onClick = { merchantFilter = null }, label = { Text("الجميع") })
                    merchants.forEach { merchant -> AssistChip(onClick = { merchantFilter = merchant.id }, label = { Text(merchant.name) }) }
                }
            }
        }
        if (user.role == Role.MERCHANT && eligible.isNotEmpty()) item {
            SectionCard(title = "طرود جاهزة للتحصيل") {
                Text("${eligible.size} طرد واصل أو راجع لم تُفوتر شحنته الحالية.")
                PrimaryButton("إنشاء فاتورة لهذه الطرود", { createConfirm = true }, icon = Icons.AutoMirrored.Outlined.ReceiptLong, busy = state.busy)
            }
        }
        if (visible.isEmpty()) item { EmptyState("لا توجد فواتير", "ستظهر فواتير التحصيل هنا عند إنشائها.") }
        else items(visible, key = { it.id }) { invoice ->
            SwipeDeleteRow(
                enabled = snapshot.canHideCollection(invoice) && !state.busy && !state.offlineCache,
                title = "حذف الفاتورة من قائمتك؟",
                message = "ستُنقل الفاتورة إلى المحذوفات ويمكن استعادتها. يبقى سجل التسوية محفوظًا ولا تتغير مبالغ التحصيل.",
                onDelete = { viewModel.hideCollection(invoice.id) },
                actionLabel = "حذف الفاتورة",
            ) {
                Card(
                    Modifier.fillMaxWidth().clickable { selected = invoice },
                    shape = RoundedCornerShape(22.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .3f)),
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            InvoiceStatus(invoice.status)
                            Column(horizontalAlignment = Alignment.End) {
                                Text(invoice.invoiceNumber, fontWeight = FontWeight.ExtraBold)
                                Text(invoice.merchantName, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(collectionDueLabel(invoice.netAmount))
                            Text("${displayMoney(kotlin.math.abs(invoice.netAmount))} ₪", fontWeight = FontWeight.ExtraBold)
                        }
                        if (user.role != Role.MERCHANT && invoice.status == "pending") {
                            PrimaryButton("تجهيز الفاتورة", { viewModel.prepareCollection(invoice) }, busy = state.busy)
                        }
                        if (user.role != Role.MERCHANT && invoice.status == "ready") {
                            PrimaryButton("التحقق وتسليم التحصيل", { verifying = invoice }, icon = Icons.Outlined.QrCodeScanner, busy = state.busy)
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(92.dp)) }
    }

    if (createConfirm) AlertDialog(
        onDismissRequest = { createConfirm = false },
        title = { Text("إنشاء فاتورة تحصيل؟") },
        text = { Text("سيتم احتساب الرسوم والأسعار نهائيًا داخل الخادم لجميع الطرود المؤهلة.") },
        confirmButton = { TextButton(onClick = { viewModel.createCollection(eligible.map { it.id }) { createConfirm = false } }) { Text("إنشاء") } },
        dismissButton = { TextButton(onClick = { createConfirm = false }) { Text("إلغاء") } },
    )

    selected?.let { selectedInvoice ->
        snapshot.collections.firstOrNull { it.id == selectedInvoice.id }?.let { invoice ->
            InvoiceDialog(invoice, user.role, viewModel, onDismiss = { selected = null })
        }
    }

    verifying?.let { invoice ->
        AlertDialog(
            onDismissRequest = { verifying = null },
            title = { Text("تسليم ${invoice.invoiceNumber}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("أدخل رقم كود التحقق المكوّن من 4 أرقام الذي أعطاك إياه المستخدم.")
                    AppField(
                        code,
                        { code = it.filter(Char::isDigit).take(4) },
                        "رقم كود التحقق",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    )
                }
            },
            confirmButton = { TextButton(onClick = { viewModel.verifyCollection(invoice, code); verifying = null; code = "" }) { Text("تحقق وتسليم") } },
            dismissButton = { TextButton(onClick = { verifying = null }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun InvoiceDialog(invoice: CollectionItem, role: Role, viewModel: AppViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تفاصيل ${invoice.invoiceNumber}") },
        text = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = 580.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                InvoiceStatus(invoice.status)
                Text(invoice.merchantName, fontWeight = FontWeight.Bold)
                InvoiceLine("إجمالي مبالغ الطرود", invoice.grossAmount)
                InvoiceLine("رسوم التوصيل", invoice.deliveryFees)
                InvoiceLine(if (role == Role.MERCHANT) "رسوم الرواجع — مستحق" else "رسوم الرواجع — مستحق للشركة", invoice.returnFees)
                InvoiceLine(collectionDueLabel(invoice.netAmount), invoice.netAmount, true)
                Text("${invoice.deliveredCount} واصل · ${invoice.returnedCount} راجع", style = MaterialTheme.typography.bodySmall)
                if (role == Role.MERCHANT && invoice.status != "paid") {
                    val code = invoice.verificationCode.trim()
                    if (Regex("^[0-9]{4}$").matches(code)) {
                        val bitmap = remember(code) { createQrBitmap(code, 420) }
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        ) {
                            Column(
                                Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text("رقم كود تحقق الفاتورة", fontWeight = FontWeight.ExtraBold)
                                Text(
                                    code.toCharArray().joinToString("  "),
                                    style = MaterialTheme.typography.headlineLarge.copy(textDirection = TextDirection.Ltr),
                                    fontWeight = FontWeight.Black,
                                )
                                OutlinedButton(onClick = { copyVerificationCode(context, code) }) {
                                    Icon(Icons.Outlined.ContentCopy, null, Modifier.size(18.dp))
                                    Text("نسخ الرقم")
                                }
                            }
                        }
                        Text(
                            if (invoice.status == "ready") "أعطِ هذا الرقم للموظف أو المندوب أو المسؤول عند استلام التحصيل."
                            else "احتفظ بهذا الرقم؛ سيُستخدم بعد تجهيز الفاتورة لاستلام التحصيل.",
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text("رمز QR لنفس كود التحقق", style = MaterialTheme.typography.labelMedium)
                        Image(bitmap.asImageBitmap(), "رمز تحقق الفاتورة", Modifier.size(152.dp))
                        TextButton(onClick = { viewModel.regenerateCollectionVerificationCode(invoice) }) {
                            Icon(Icons.Outlined.Refresh, null)
                            Text("تحديث كود التحقق")
                        }
                    } else {
                        Text("لم يُنشأ كود تحقق صالح لهذه الفاتورة بعد.", textAlign = TextAlign.Center)
                        PrimaryButton(
                            "إنشاء كود التحقق",
                            { viewModel.regenerateCollectionVerificationCode(invoice) },
                            icon = Icons.Outlined.QrCode2,
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } },
    )
}

private fun copyVerificationCode(context: Context, code: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("كود تحقق الفاتورة", code))
    Toast.makeText(context, "تم نسخ كود التحقق", Toast.LENGTH_SHORT).show()
}

private fun collectionDueLabel(amount: Double): String = when {
    amount > 0 -> "مستحق للمستخدم"
    amount < 0 -> "مستحق للشركة"
    else -> "الرصيد المستحق"
}

@Composable
private fun InvoiceLine(label: String, amount: Double, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal)
        Text("${displayMoney(kotlin.math.abs(amount))} ₪", fontWeight = if (strong) FontWeight.ExtraBold else FontWeight.Bold)
    }
}

@Composable
private fun InvoiceStatus(status: String) {
    val (label, color) = when (status) {
        "paid" -> "تم التسليم" to Color(0xFF168653)
        "ready" -> "جاهزة للتحصيل" to Color(0xFF6453B2)
        else -> "قيد التجهيز" to Color(0xFFBC7629)
    }
    Surface(shape = RoundedCornerShape(50), color = color.copy(alpha = .13f), contentColor = color) {
        Text(label, Modifier.padding(horizontal = 12.dp, vertical = 7.dp), fontWeight = FontWeight.Bold)
    }
}

@Composable
fun NotificationsScreen(state: MainUiState, viewModel: AppViewModel, onSelectOrder: (String) -> Unit) {
    val notices = state.snapshot?.notices?.sortedByDescending { it.createdAt }.orEmpty()
    var clearConfirm by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item {
            ScreenHeader("الإشعارات", "آخر تحديثات حسابك", action = {
                if (notices.isNotEmpty()) IconButton(onClick = { clearConfirm = true }) { Icon(Icons.Outlined.DeleteOutline, "حذف كل الإشعارات") }
            })
        }
        if (notices.isEmpty()) item { EmptyState("لا توجد إشعارات", "ستظهر هنا تحديثات الطرود والتحصيلات والملاحظات.") }
        else items(notices, key = { it.id }) { notice ->
            Card(
                Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(22.dp),
                colors = CardDefaults.cardColors(containerColor = if (notice.read) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primaryContainer.copy(alpha = .45f)),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .3f)),
            ) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { viewModel.deleteNotice(notice.id) }) { Icon(Icons.Outlined.DeleteOutline, "حذف هذا الإشعار", tint = MaterialTheme.colorScheme.error) }
                    Column(
                        Modifier.weight(1f).clickable {
                            if (!notice.read) viewModel.markNoticeRead(notice)
                            notice.orderId?.let(onSelectOrder)
                        }.padding(7.dp),
                        horizontalAlignment = Alignment.End,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(notice.title, fontWeight = FontWeight.ExtraBold)
                        Text(notice.message, style = MaterialTheme.typography.bodyMedium)
                        Text(displayDate(notice.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(if (notice.read) Icons.Outlined.CheckCircle else Icons.Outlined.Notifications, null, tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
        item { Spacer(Modifier.height(86.dp)) }
    }
    if (clearConfirm) AlertDialog(
        onDismissRequest = { clearConfirm = false },
        title = { Text("حذف جميع الإشعارات؟") },
        text = { Text("سيتم حذف إشعارات هذا الحساب فقط.") },
        confirmButton = { TextButton(onClick = { viewModel.clearAllNotices(); clearConfirm = false }) { Text("حذف الكل") } },
        dismissButton = { TextButton(onClick = { clearConfirm = false }) { Text("إلغاء") } },
    )
}

@Composable
fun ScanScreen(
    state: MainUiState,
    viewModel: AppViewModel,
    onScanCode: ((String) -> Unit) -> Unit,
    onSelectOrder: (String) -> Unit,
) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    var tracking by rememberSaveable { mutableStateOf("") }
    var scanError by rememberSaveable { mutableStateOf<String?>(null) }
    val handleTracking: (String) -> Unit = { value ->
        val normalized = Regex("ALX-[0-9]+", RegexOption.IGNORE_CASE).find(value)?.value?.uppercase()
            ?: value.trim().uppercase()
        tracking = normalized
        scanError = null
        if (normalized.isBlank()) {
            scanError = "أدخل كود الطرد أولًا."
        } else if (user.role == Role.COURIER) {
            viewModel.shipScannedOrder(normalized)
        } else {
            val order = snapshot.orders.firstOrNull {
                !it.deleted && it.trackingNumber.isNotBlank() && it.trackingNumber.equals(normalized, ignoreCase = true)
            }
            if (order == null) scanError = "لم يُعثر على طرد بهذا الرقم ضمن حسابك."
            else onSelectOrder(order.id)
        }
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            ScreenHeader(
                "قراءة كود الطرد",
                if (user.role == Role.COURIER) "يحوّل الطرد من جاهز للإرسال أو راجع إلى مشحون" else "يفتح تفاصيل الطرد المطابق",
            )
        }
        item {
            SectionCard {
                Box(Modifier.fillMaxWidth().height(190.dp), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.QrCode2, null, Modifier.size(112.dp), tint = MaterialTheme.colorScheme.primary)
                }
                PrimaryButton("فتح الكاميرا", {
                    onScanCode(handleTracking)
                }, icon = Icons.Outlined.QrCodeScanner, busy = state.busy)
                Text("إذا لم تتوفر خدمات Google على الهاتف، أدخل رقم التتبع يدويًا.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                AppField(tracking, { tracking = it.uppercase() }, "ALX-000000")
                scanError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                PrimaryButton(
                    if (user.role == Role.COURIER) "اعتماد رقم التتبع" else "فتح تفاصيل الطرد",
                    { handleTracking(tracking) },
                    busy = state.busy,
                )
            }
        }
    }
}

fun createQrBitmap(value: String, size: Int): Bitmap {
    val matrix: BitMatrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size)
    for (y in 0 until size) for (x in 0 until size) pixels[y * size + x] = if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
    return createBitmap(size, size, Bitmap.Config.ARGB_8888).apply { setPixels(pixels, 0, size, 0, 0, size, size) }
}
