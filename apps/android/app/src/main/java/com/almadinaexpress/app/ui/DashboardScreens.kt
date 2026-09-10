package com.almadinaexpress.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.automirrored.outlined.FactCheck
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.SupervisorAccount
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.TextButton
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.Membership
import com.almadinaexpress.app.data.OrderItem
import com.almadinaexpress.app.data.OrderStatus
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.displayMoney
import com.almadinaexpress.app.ui.theme.BrandGreen
import com.almadinaexpress.app.ui.theme.BrandGreenDark

private data class OverviewSpec(
    val title: String,
    val value: String,
    val subtitle: String,
    val progress: Float,
    val icon: ImageVector,
    val tint: Color,
)

@Composable
fun HomeScreen(
    state: MainUiState,
    viewModel: AppViewModel,
    onSelectOrder: (String) -> Unit,
    onNavigate: (Destination) -> Unit,
    searchVisible: Boolean,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    selectedStatus: String?,
    onStatusChange: (String?) -> Unit,
    onClearFilters: () -> Unit,
) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    val orders = snapshot.orders.filter { !it.deleted }
    val delivered = orders.count { it.status == OrderStatus.DELIVERED }
    val completion = if (orders.isEmpty()) 0f else delivered.toFloat() / orders.size.toFloat()
    val pendingCollections = snapshot.collections.filter { it.status != "paid" }
    val pendingAmount = pendingCollections.sumOf { kotlin.math.abs(it.netAmount) }
    val ready = orders.count { it.status == OrderStatus.READY }
    val active = orders.count { it.status == OrderStatus.SHIPPED || it.status == OrderStatus.PROCESSING }
    val selectedOrderStatus = OrderStatus.entries.firstOrNull { it.apiValue == selectedStatus }
    val hasActiveFilters = searchQuery.isNotBlank() || selectedOrderStatus != null
    val matchingOrders = remember(snapshot.revision, searchQuery, selectedStatus) {
        snapshot.orders.filter { order ->
            !order.deleted &&
                (selectedStatus == null || order.status.apiValue == selectedStatus) &&
                (
                    searchQuery.isBlank() ||
                        listOf(
                            order.trackingNumber,
                            order.recipientName,
                            order.recipientPhone,
                            order.merchantName,
                        ).any { it.contains(searchQuery.trim(), ignoreCase = true) }
                    )
        }.sortedByDescending { it.updatedAt }
    }
    val latestOrders = remember(snapshot.revision) {
        orders.sortedByDescending { it.createdAt }.take(6)
    }
    val overviewCards = when (user.role) {
        Role.ADMIN -> listOf(
            OverviewSpec("إجمالي الطرود", orders.size.toString(), "$delivered تم تسليمها", completion, Icons.Outlined.LocalShipping, BrandGreen),
            OverviewSpec(
                "الحسابات",
                snapshot.users.size.toString(),
                "${snapshot.users.count { it.role == Role.MERCHANT }} مستخدم",
                if (snapshot.users.isEmpty()) 0f else snapshot.users.count { it.role == Role.MERCHANT }.toFloat() / snapshot.users.size,
                Icons.Outlined.SupervisorAccount,
                Color(0xFF7D57C2),
            ),
        )
        Role.COURIER -> listOf(
            OverviewSpec("جاهز للتوصيل", ready.toString(), "من ${orders.size} طرد", if (orders.isEmpty()) 0f else ready.toFloat() / orders.size, Icons.Outlined.Inventory2, Color(0xFF3D75C5)),
            OverviewSpec("قيد التوصيل", active.toString(), "مهام نشطة", if (orders.isEmpty()) 0f else active.toFloat() / orders.size, Icons.Outlined.LocalShipping, BrandGreen),
        )
        Role.MERCHANT -> listOf(
            OverviewSpec("نسبة الواصل", "${(completion * 100).toInt()}%", "$delivered من ${orders.size}", completion, Icons.Outlined.LocalShipping, Color(0xFFBFC8D0)),
            OverviewSpec(
                "التحصيلات",
                "${displayMoney(pendingAmount)} ₪",
                "${pendingCollections.size} مستحقة",
                if (snapshot.collections.isEmpty()) 0f else pendingCollections.size.toFloat() / snapshot.collections.size,
                Icons.AutoMirrored.Outlined.ReceiptLong,
                MaterialTheme.colorScheme.primary,
            ),
        )
    }
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        item {
            ScreenHeader(
                title = when (user.role) {
                    Role.ADMIN -> "لوحة الإدارة"
                    Role.COURIER -> "لوحة المندوب"
                    Role.MERCHANT -> "لوحة المتابعة"
                },
                subtitle = when (user.role) {
                    Role.ADMIN -> "مرحبًا ${user.name} · ملخص عمليات الشركة"
                    Role.COURIER -> "مرحبًا ${user.name} · طرودك ومهام التحصيل"
                    Role.MERCHANT -> "مرحبًا ${user.name} · طرودك وتحصيلاتك"
                },
            )
        }
        if (searchVisible) {
            item {
                AppField(
                    value = searchQuery,
                    onValueChange = onSearchQueryChange,
                    label = "ابحث برقم التتبع أو الاسم أو الجوال",
                    leadingIcon = { Icon(Icons.Outlined.Search, null) },
                )
            }
        }
        item { RoleDashboardHero(user.role, user.name, user.store) }
        item {
            AdaptiveItemRow(itemCount = overviewCards.size, stackBelow = 370.dp) { index, itemModifier ->
                val card = overviewCards[index]
                OverviewCard(
                    title = card.title,
                    value = card.value,
                    subtitle = card.subtitle,
                    progress = card.progress,
                    icon = card.icon,
                    tint = card.tint,
                    modifier = itemModifier,
                )
            }
        }
        if (user.role != Role.MERCHANT) {
            item { RoleQuickActions(user.role, onNavigate) }
        }
        item { Text("حالات الطرود", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold) }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columns = when {
                    maxWidth >= 760.dp -> 4
                    maxWidth < 340.dp -> 1
                    else -> 2
                }
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    OrderStatus.entries.chunked(columns).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            row.forEach { status ->
                                StatusDashboardCard(
                                    status = status,
                                    count = orders.count { it.status == status },
                                    selected = selectedOrderStatus == status,
                                    onClick = {
                                        onStatusChange(if (selectedOrderStatus == status) null else status.apiValue)
                                    },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
        if (hasActiveFilters) {
            item {
                Text(
                    when {
                        selectedOrderStatus != null && searchQuery.isNotBlank() -> "نتائج البحث — ${selectedOrderStatus.arabic}"
                        selectedOrderStatus != null -> "طرود حالة ${selectedOrderStatus.arabic}"
                        else -> "نتائج البحث"
                    },
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.ExtraBold,
                )
            }
            if (matchingOrders.isEmpty()) {
                item {
                    EmptyState(
                        title = "لا توجد طرود مطابقة",
                        description = "غيّر عبارة البحث أو اختر حالة أخرى.",
                        action = "مسح التصفية",
                        onAction = onClearFilters,
                    )
                }
            } else {
                items(matchingOrders, key = { "filtered-${it.id}" }) { order -> SwipeParcelCard(order, state, viewModel) { onSelectOrder(order.id) } }
            }
        }
        item {
            Text(
                when (user.role) {
                    Role.ADMIN -> "أحدث طرود الشركة"
                    Role.COURIER -> "أحدث مهام التوصيل"
                    Role.MERCHANT -> "أحدث الطرود"
                },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.ExtraBold,
            )
        }
        if (latestOrders.isEmpty()) {
            item {
                EmptyState(
                    "لا توجد طرود",
                    "ستظهر هنا الطرود بعد إنشائها.",
                    if (user.role == Role.MERCHANT) "إنشاء طرد" else null,
                ) { onNavigate(Destination.NEW_ORDER) }
            }
        } else {
            items(latestOrders, key = { "latest-${it.id}" }) { order -> SwipeParcelCard(order, state, viewModel) { onSelectOrder(order.id) } }
        }
        item { Spacer(Modifier.height(96.dp)) }
    }
}

@Composable
private fun RoleDashboardHero(role: Role, name: String, store: String) {
    val icon = when (role) {
        Role.ADMIN -> Icons.Outlined.AdminPanelSettings
        Role.COURIER -> Icons.Outlined.LocalShipping
        Role.MERCHANT -> Icons.Outlined.Storefront
    }
    val title = when (role) {
        Role.ADMIN -> "إدارة المدينة إكسبرس"
        Role.COURIER -> "حساب المندوب / الموظف"
        Role.MERCHANT -> store.ifBlank { "حساب المستخدم" }
    }
    val subtitle = when (role) {
        Role.ADMIN -> "إدارة الحسابات والطرود والتحصيلات من مكان واحد"
        Role.COURIER -> "متابعة الطرود والمسح السريع ومهام التحصيل"
        Role.MERCHANT -> "أهلًا $name، تابع شحناتك وبياناتك مباشرة"
    }
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(BrandGreenDark, BrandGreen)))
                .padding(horizontal = 18.dp, vertical = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(title, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Text(subtitle, color = Color.White.copy(alpha = .82f), style = MaterialTheme.typography.bodySmall)
            }
            Box(
                Modifier.size(60.dp).background(Color.White.copy(alpha = .16f), RoundedCornerShape(18.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, Modifier.size(32.dp), tint = Color.White) }
        }
    }
}

@Composable
private fun RoleQuickActions(role: Role, onNavigate: (Destination) -> Unit) {
    val actions = when (role) {
        Role.ADMIN -> listOf(
            Triple("إدارة الحسابات", Icons.Outlined.SupervisorAccount, Destination.USERS),
            Triple("أكواد الطرود للطباعة", Icons.Outlined.Print, Destination.PARCEL_CODES),
            Triple("إرسال إشعار", Icons.Outlined.NotificationsActive, Destination.BROADCAST),
            Triple("جميع الطرود", Icons.Outlined.LocalShipping, Destination.ORDERS),
            Triple("التحصيلات", Icons.AutoMirrored.Outlined.ReceiptLong, Destination.COLLECTIONS),
        )
        Role.COURIER -> listOf(
            Triple("مسح كود طرد", Icons.Outlined.QrCodeScanner, Destination.SCAN),
            Triple("طرود التوصيل", Icons.Outlined.LocalShipping, Destination.ORDERS),
            Triple("التحصيلات", Icons.AutoMirrored.Outlined.ReceiptLong, Destination.COLLECTIONS),
            Triple("الرواجع", Icons.Outlined.Replay, Destination.RETURNS),
        )
        Role.MERCHANT -> emptyList()
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("إجراءات سريعة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
        actions.chunked(2).forEach { row ->
            AdaptiveItemRow(itemCount = row.size, stackBelow = 370.dp) { index, itemModifier ->
                val (label, icon, destination) = row[index]
                    Card(
                        modifier = itemModifier.clickable { onNavigate(destination) },
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(label, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
                        }
                    }
            }
        }
    }
}

@Composable
private fun OverviewCard(
    title: String,
    value: String,
    subtitle: String,
    progress: Float,
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .35f)),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(11.dp),
            horizontalArrangement = Arrangement.spacedBy(9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) },
                    modifier = Modifier.size(54.dp),
                    color = tint,
                    trackColor = MaterialTheme.colorScheme.outline.copy(alpha = .25f),
                    strokeWidth = 4.dp,
                )
                Icon(icon, null, Modifier.size(22.dp), tint = tint)
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun StatusDashboardCard(
    status: OrderStatus,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tint = Color(status.color)
    val icon = when (status) {
        OrderStatus.DRAFT -> Icons.Outlined.EditNote
        OrderStatus.READY -> Icons.Outlined.Inventory2
        OrderStatus.SHIPPED -> Icons.Outlined.LocalShipping
        OrderStatus.PROCESSING -> Icons.AutoMirrored.Outlined.FactCheck
        OrderStatus.DELIVERED -> Icons.Outlined.CheckCircle
        OrderStatus.STUCK -> Icons.Outlined.ErrorOutline
        OrderStatus.RETURNED -> Icons.Outlined.Replay
        OrderStatus.DEFERRED -> Icons.Outlined.Schedule
    }
    Card(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) tint.copy(alpha = .20f) else MaterialTheme.colorScheme.surfaceVariant,
        ),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) tint else Color.Transparent),
    ) {
        Row(Modifier.fillMaxWidth().height(50.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.height(50.dp).weight(.38f).background(tint),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = Color.White) }
            Column(Modifier.weight(.62f).padding(horizontal = 8.dp), horizontalAlignment = Alignment.End) {
                Text(status.arabic, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(count.toString(), fontWeight = FontWeight.ExtraBold)
            }
        }
    }
}

@Composable
fun OrdersScreen(
    state: MainUiState,
    viewModel: AppViewModel,
    onSelectOrder: (String) -> Unit,
    onNavigate: (Destination) -> Unit,
    query: String,
    onQueryChange: (String) -> Unit,
    status: String?,
    onStatusChange: (String?) -> Unit,
) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    val orders = remember(snapshot.revision, query, status) {
        snapshot.orders.filter { order ->
            !order.deleted && (status == null || order.status.apiValue == status) &&
                (query.isBlank() || listOf(order.trackingNumber, order.recipientName, order.recipientPhone, order.merchantName).any { it.contains(query, true) })
        }.sortedByDescending { it.updatedAt }
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ScreenHeader("الطرود", "${orders.size} طرد") }
        item { AppField(query, onQueryChange, "ابحث برقم التتبع أو الاسم أو الجوال") }
        item {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = status == null,
                    onClick = { onStatusChange(null) },
                    label = { Text("الكل") },
                )
                OrderStatus.entries.forEach { item ->
                    FilterChip(
                        selected = status == item.apiValue,
                        onClick = { onStatusChange(item.apiValue) },
                        label = { Text(item.arabic) },
                    )
                }
            }
        }
        if (orders.isEmpty()) item { EmptyState("لا توجد نتائج", "غيّر البحث أو حالة الطرد.", if (user.role == Role.MERCHANT) "إنشاء طرد" else null) { onNavigate(Destination.NEW_ORDER) } }
        else items(orders, key = { it.id }) { order -> SwipeParcelCard(order, state, viewModel) { onSelectOrder(order.id) } }
        item { Spacer(Modifier.height(96.dp)) }
    }
}

@Composable
fun ReturnsScreen(state: MainUiState, viewModel: AppViewModel, onSelectOrder: (String) -> Unit, onNavigate: (Destination) -> Unit) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    val returns = snapshot.orders.filter { !it.deleted && it.status == OrderStatus.RETURNED }
    val prices = when (user.membership) {
        Membership.DIAMOND -> Triple(10, 15, 25)
        Membership.PREMIUM -> Triple(15, 25, 40)
        Membership.STANDARD -> Triple(20, 30, 50)
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ScreenHeader("الرواجع", "الطرود الراجعة إلى المرسل") }
        item {
            SectionCard(title = "رسوم الرواجع — ${if (user.role == Role.MERCHANT) "مستحق" else "مستحق للشركة"}") {
                if (user.role == Role.MERCHANT) {
                    Text("الضفة الغربية ${prices.first} ₪ · القدس ${prices.second} ₪ · الداخل ${prices.third} ₪")
                } else {
                    Text("الماسي: الضفة 10 ₪ · القدس 15 ₪ · الداخل 25 ₪")
                    Text("البريميوم: الضفة 15 ₪ · القدس 25 ₪ · الداخل 40 ₪")
                    Text("العادي: الضفة 20 ₪ · القدس 30 ₪ · الداخل 50 ₪")
                }
            }
        }
        item {
            AdaptiveItemRow(itemCount = 2, stackBelow = 360.dp, spacing = 10.dp) { index, itemModifier ->
                if (index == 0) {
                    MetricCard("عدد الرواجع", returns.size.toString(), Icons.Outlined.Replay, Color(0xFFC35A52), itemModifier)
                } else {
                    MetricCard("قيمة الطرود", "${displayMoney(returns.sumOf { it.amount })} ₪", Icons.Outlined.Payments, Color(0xFFBC7629), itemModifier)
                }
            }
        }
        if (returns.isEmpty()) item { EmptyState("لا توجد رواجع", "لا توجد طرود راجعة حاليًا.") }
        else items(returns, key = { it.id }) { order -> SwipeParcelCard(order, state, viewModel) { onSelectOrder(order.id) } }
        item { Spacer(Modifier.height(96.dp)) }
    }
}

@Composable
fun TrashScreen(state: MainUiState, viewModel: AppViewModel, onSelectOrder: (String) -> Unit) {
    val snapshot = state.snapshot ?: return
    val deleted = remember(snapshot) { snapshot.orders.filter { it.deleted && snapshot.canTrash(it) } }
    val invoices = remember(snapshot) {
        val ids = snapshot.trashedCollectionIds
        snapshot.collections.filter { it.id in ids }
    }
    val eligibleOrders = remember(snapshot) { deleted.filter(snapshot::canPurge).map { it.id }.toSet() }
    val eligibleInvoices = remember(snapshot) { invoices.map { it.id }.toSet() }
    var selectedOrders by remember(snapshot.userId) { mutableStateOf(setOf<String>()) }
    var selectedInvoices by remember(snapshot.userId) { mutableStateOf(setOf<String>()) }
    var confirming by remember(snapshot.userId) { mutableStateOf(false) }
    val count = selectedOrders.size + selectedInvoices.size
    val locked = state.busy || state.offlineCache
    LaunchedEffect(snapshot.revision) {
        selectedOrders = selectedOrders.intersect(eligibleOrders)
        selectedInvoices = selectedInvoices.intersect(eligibleInvoices)
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ScreenHeader("المحذوفات", "يمكن استعادة الطرود خلال 30 يومًا قبل حذفها نهائيًا") }
        if (eligibleOrders.isNotEmpty() || invoices.isNotEmpty()) item {
            SectionCard {
                TextButton(enabled = !locked, onClick = {
                    if (count == eligibleOrders.size + eligibleInvoices.size) { selectedOrders = emptySet(); selectedInvoices = emptySet() }
                    else { selectedOrders = eligibleOrders; selectedInvoices = eligibleInvoices }
                }) { Text(if (count == eligibleOrders.size + eligibleInvoices.size) "إلغاء التحديد" else "تحديد الكل") }
                Button(onClick = { confirming = true }, enabled = !locked && count > 0, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) {
                    Text("حذف المحدد ($count)")
                }
                Text("${selectedOrders.size} طرد · ${selectedInvoices.size} فاتورة", style = MaterialTheme.typography.bodySmall)
            }
        }
        if (deleted.isEmpty() && invoices.isEmpty()) item { EmptyState("المحذوفات فارغة", "ستظهر هنا الطرود والفواتير التي تحذفها من قائمتك.") }
        items(deleted, key = { "order-${it.id}" }) { order ->
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = order.id in selectedOrders, enabled = !locked && order.id in eligibleOrders,
                        onCheckedChange = { selectedOrders = if (it) selectedOrders + order.id else selectedOrders - order.id },
                        modifier = Modifier.semantics { contentDescription = "تحديد الطرد ${order.trackingNumber.ifBlank { order.recipientName }}" })
                    Text("تحديد الطرد", modifier = Modifier.weight(1f))
                }
                OrderCard(order) { onSelectOrder(order.id) }
                if (order.id !in eligibleOrders) Text("الطرد مرتبط بفاتورة مستحقة", style = MaterialTheme.typography.bodySmall)
                PrimaryButton("استعادة الطرد", { viewModel.restoreOrder(order.id) }, busy = state.busy, enabled = !state.offlineCache)
            }
        }
        if (invoices.isNotEmpty()) item { Text("الفواتير المحذوفة من قائمتك", fontWeight = FontWeight.Bold) }
        if (invoices.isNotEmpty()) item { Text("يبقى سجل التسوية محفوظًا بعد حذف الفاتورة من سلة محذوفاتك.", style = MaterialTheme.typography.bodySmall) }
        items(invoices, key = { "invoice-${it.id}" }) { invoice ->
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = invoice.id in selectedInvoices, enabled = !locked,
                        onCheckedChange = { selectedInvoices = if (it) selectedInvoices + invoice.id else selectedInvoices - invoice.id },
                        modifier = Modifier.semantics { contentDescription = "تحديد الفاتورة ${invoice.invoiceNumber}" })
                    Text(invoice.invoiceNumber, modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold)
                }
                Text(invoice.merchantName)
                PrimaryButton("استعادة الفاتورة", { viewModel.hideCollection(invoice.id, false) }, busy = state.busy, enabled = !state.offlineCache)
            }
        }
        item { Spacer(Modifier.height(80.dp)) }
    }
    if (confirming) AlertDialog(
        onDismissRequest = { confirming = false },
        title = { Text("حذف المحدد نهائيًا؟") },
        text = { Text("سيتم حذف ${selectedOrders.size} طرد و${selectedInvoices.size} فاتورة من سلة محذوفاتك. لن تتمكن من استعادتها.") },
        confirmButton = { TextButton(enabled = !locked && count > 0, onClick = {
            confirming = false
            viewModel.purgeTrash(selectedOrders, selectedInvoices) { selectedOrders = emptySet(); selectedInvoices = emptySet() }
        }) { Text("حذف المحدد ($count)", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirming = false }) { Text("إلغاء") } },
    )
}
