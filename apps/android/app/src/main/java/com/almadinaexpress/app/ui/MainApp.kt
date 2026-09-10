package com.almadinaexpress.app.ui

import javax.crypto.Cipher

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DeleteSweep
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SupervisorAccount
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.PermanentNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.BuildConfig
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.UserItem
import com.almadinaexpress.app.ui.theme.ReferenceCyan
import kotlinx.coroutines.launch

enum class Destination(val label: String, val icon: ImageVector) {
    HOME("الرئيسية", Icons.Outlined.Home),
    ORDERS("الطرود", Icons.Outlined.LocalShipping),
    COLLECTIONS("التحصيلات", Icons.AutoMirrored.Outlined.ReceiptLong),
    RETURNS("الرواجع", Icons.Outlined.Replay),
    NOTIFICATIONS("الإشعارات", Icons.Outlined.Notifications),
    SETTINGS("الإعدادات", Icons.Outlined.Settings),
    USERS("الحسابات", Icons.Outlined.SupervisorAccount),
    BROADCAST("إرسال إشعار", Icons.AutoMirrored.Outlined.Send),
    PARCEL_CODES("أكواد الطرود للطباعة", Icons.Outlined.Print),
    TRASH("المحذوفات", Icons.Outlined.DeleteOutline),
    PROFILE("الملف الشخصي", Icons.Outlined.AccountCircle),
    NEW_ORDER("طرد جديد", Icons.Outlined.Add),
    ORDER_DETAIL("تفاصيل الطرد", Icons.Outlined.LocalShipping),
    SCAN("مسح كود", Icons.Outlined.QrCodeScanner),
    LEGAL("الشروط والخصوصية", Icons.Outlined.Security),
    HELP_CENTER("مركز المساعدة", Icons.AutoMirrored.Outlined.HelpOutline),
}

@Composable
fun AppRoot(
    state: MainUiState,
    viewModel: AppViewModel,
    initialOrderId: String?,
    onInitialOrderConsumed: () -> Unit,
    onRequestNotifications: () -> Unit,
    onScanCode: ((String) -> Unit) -> Unit,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message, state.snapshot) {
        state.message?.takeIf { state.snapshot != null }?.let {
            snackbar.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }
    if (state.snapshot == null) {
        AuthScreen(state, viewModel, onBiometricAuth)
    } else {
        MainShell(
            state,
            viewModel,
            snackbar,
            initialOrderId,
            onInitialOrderConsumed,
            onRequestNotifications,
            onScanCode,
            onBiometricAuth,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(
    state: MainUiState,
    viewModel: AppViewModel,
    snackbar: SnackbarHostState,
    initialOrderId: String?,
    onInitialOrderConsumed: () -> Unit,
    onRequestNotifications: () -> Unit,
    onScanCode: ((String) -> Unit) -> Unit,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
) {
    val snapshot = state.snapshot ?: return
    val user = snapshot.currentUser ?: return
    var destinationName by rememberSaveable { mutableStateOf(Destination.HOME.name) }
    var selectedOrderId by rememberSaveable { mutableStateOf<String?>(null) }
    var orderSearchQuery by rememberSaveable { mutableStateOf("") }
    var orderStatusFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var homeSearchVisible by rememberSaveable { mutableStateOf(false) }
    var homeSearchQuery by rememberSaveable { mutableStateOf("") }
    var homeStatusFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var newOrderFormVersion by rememberSaveable { mutableIntStateOf(0) }
    val destination = runCatching { Destination.valueOf(destinationName) }.getOrDefault(Destination.HOME)
    val navigate: (Destination) -> Unit = {
        destinationName = it.name
    }

    LaunchedEffect(initialOrderId, snapshot.revision) {
        if (initialOrderId != null && snapshot.orders.any { it.id == initialOrderId }) {
            selectedOrderId = initialOrderId
            destinationName = Destination.ORDER_DETAIL.name
            onInitialOrderConsumed()
        }
    }

    BackHandler(destination !in listOf(Destination.HOME, Destination.ORDERS, Destination.COLLECTIONS, Destination.RETURNS)) {
        destinationName = when (destination) {
            Destination.ORDER_DETAIL -> Destination.ORDERS.name
            Destination.LEGAL, Destination.HELP_CENTER -> Destination.SETTINGS.name
            else -> Destination.HOME.name
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 900.dp
        val pageMaxWidth = when (destination) {
            Destination.SETTINGS,
            Destination.PROFILE,
            Destination.NEW_ORDER,
            Destination.ORDER_DETAIL,
            Destination.SCAN,
            Destination.BROADCAST,
            Destination.LEGAL,
            Destination.HELP_CENTER -> 860.dp
            Destination.USERS,
            Destination.COLLECTIONS -> 1000.dp
            else -> 1180.dp
        }
        val tabletHorizontalPadding = if (!wide && maxWidth >= 600.dp) 20.dp else 0.dp
        val drawerState = rememberDrawerState(DrawerValue.Closed)
        val scope = rememberCoroutineScope()
        val drawerContent: @Composable () -> Unit = {
            AppDrawer(
                user = user,
                destination = destination,
                onNavigate = {
                    navigate(it)
                    if (!wide) scope.launch { drawerState.close() }
                },
                onLogout = viewModel::logout,
                modifier = if (wide) Modifier else Modifier.fillMaxWidth(.84f),
            )
        }
        val page: @Composable () -> Unit = {
            Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = {
                    if (destination !in listOf(Destination.SETTINGS, Destination.PROFILE)) {
                        AppTopBar(
                            destination = destination,
                            wide = wide,
                            role = user.role,
                            unread = snapshot.notices.count { !it.read },
                            searchActive = destination == Destination.HOME && homeSearchVisible,
                            onMenu = { scope.launch { drawerState.open() } },
                            onSearch = {
                                if (destination != Destination.HOME) {
                                    homeSearchVisible = true
                                    navigate(Destination.HOME)
                                } else {
                                    homeSearchVisible = !homeSearchVisible
                                    if (!homeSearchVisible) homeSearchQuery = ""
                                }
                            },
                            onNotifications = { navigate(Destination.NOTIFICATIONS) },
                            onTrash = { navigate(Destination.TRASH) },
                            onScan = { navigate(Destination.SCAN) },
                            onClearNewOrder = {
                                newOrderFormVersion += 1
                                scope.launch { snackbar.showSnackbar("تم مسح جميع الحقول.") }
                            },
                        )
                    }
                },
                bottomBar = { if (!wide) AppBottomBar(destination, user.role, navigate) },
                floatingActionButton = {
                    if (user.role == Role.MERCHANT && destination in listOf(Destination.HOME, Destination.ORDERS)) {
                        FloatingActionButton(
                            onClick = { navigate(Destination.NEW_ORDER) },
                            shape = CircleShape,
                            containerColor = ReferenceCyan,
                            contentColor = Color(0xFF06383A),
                        ) { Icon(Icons.Outlined.Add, "إنشاء طرد", Modifier.size(30.dp)) }
                    }
                },
            ) { padding ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    if (state.offlineCache) OfflineBanner { viewModel.refresh() }
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                        Box(
                            Modifier
                                .fillMaxHeight()
                                .widthIn(max = pageMaxWidth)
                                .fillMaxWidth()
                                .padding(horizontal = if (wide) 22.dp else tabletHorizontalPadding),
                        ) {
                            AppDestination(
                                destination = destination,
                                state = state,
                                viewModel = viewModel,
                                selectedOrderId = selectedOrderId,
                                onSelectOrder = { selectedOrderId = it; navigate(Destination.ORDER_DETAIL) },
                                onNavigate = navigate,
                                onRequestNotifications = onRequestNotifications,
                                onScanCode = onScanCode,
                                onBiometricAuth = onBiometricAuth,
                                orderSearchQuery = orderSearchQuery,
                                onOrderSearchQueryChange = { orderSearchQuery = it },
                                orderStatusFilter = orderStatusFilter,
                                onOrderStatusFilterChange = { orderStatusFilter = it },
                                homeSearchVisible = homeSearchVisible,
                                homeSearchQuery = homeSearchQuery,
                                onHomeSearchQueryChange = { homeSearchQuery = it },
                                homeStatusFilter = homeStatusFilter,
                                onHomeStatusFilterChange = { homeStatusFilter = it },
                                onClearHomeFilters = {
                                    homeSearchQuery = ""
                                    homeStatusFilter = null
                                },
                                newOrderFormVersion = newOrderFormVersion,
                            )
                        }
                    }
                }
            }
        }

        if (wide) {
            PermanentNavigationDrawer(
                drawerContent = {
                    PermanentDrawerSheet(
                        Modifier.size(width = 292.dp, height = maxHeight),
                        drawerContainerColor = MaterialTheme.colorScheme.surface,
                    ) { drawerContent() }
                },
            ) { page() }
        } else {
            ModalNavigationDrawer(
                drawerState = drawerState,
                drawerContent = {
                    ModalDrawerSheet(drawerContainerColor = MaterialTheme.colorScheme.surface) { drawerContent() }
                },
            ) { page() }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppTopBar(
    destination: Destination,
    wide: Boolean,
    role: Role,
    unread: Int,
    searchActive: Boolean,
    onMenu: () -> Unit,
    onSearch: () -> Unit,
    onNotifications: () -> Unit,
    onTrash: () -> Unit,
    onScan: () -> Unit,
    onClearNewOrder: () -> Unit,
) {
    TopAppBar(
        title = {},
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
        navigationIcon = {
            if (!wide && destination != Destination.NEW_ORDER) IconButton(onClick = onMenu) { Icon(Icons.Outlined.Menu, "القائمة") }
        },
        actions = {
            if (destination == Destination.NEW_ORDER) {
                TextButton(onClick = onClearNewOrder) {
                    Icon(Icons.Outlined.DeleteSweep, null, Modifier.size(20.dp))
                    Text("مسح جميع الحقول", Modifier.padding(horizontal = 6.dp), fontWeight = FontWeight.Bold)
                }
            } else {
                IconButton(onClick = onNotifications) {
                    BadgedBox(badge = { if (unread > 0) Badge { Text(unread.coerceAtMost(99).toString()) } }) {
                        Icon(Icons.Outlined.Notifications, "الإشعارات")
                    }
                }
                if (role != Role.COURIER) {
                    IconButton(onClick = onTrash) { Icon(Icons.Outlined.DeleteOutline, "المحذوفات") }
                }
                IconButton(onClick = onSearch) {
                    Icon(
                        if (searchActive) Icons.Outlined.Close else Icons.Outlined.Search,
                        if (searchActive) "إغلاق البحث" else "البحث في لوحة المتابعة",
                    )
                }
                IconButton(onClick = onScan) { Icon(Icons.Outlined.QrCodeScanner, "قراءة كود الطرد") }
            }
        },
    )
}

@Composable
private fun AppDestination(
    destination: Destination,
    state: MainUiState,
    viewModel: AppViewModel,
    selectedOrderId: String?,
    onSelectOrder: (String) -> Unit,
    onNavigate: (Destination) -> Unit,
    onRequestNotifications: () -> Unit,
    onScanCode: ((String) -> Unit) -> Unit,
    onBiometricAuth: ((Cipher) -> Unit, (String) -> Unit) -> Unit,
    orderSearchQuery: String,
    onOrderSearchQueryChange: (String) -> Unit,
    orderStatusFilter: String?,
    onOrderStatusFilterChange: (String?) -> Unit,
    homeSearchVisible: Boolean,
    homeSearchQuery: String,
    onHomeSearchQueryChange: (String) -> Unit,
    homeStatusFilter: String?,
    onHomeStatusFilterChange: (String?) -> Unit,
    onClearHomeFilters: () -> Unit,
    newOrderFormVersion: Int,
) {
    when (destination) {
        Destination.HOME -> HomeScreen(
            state = state,
            viewModel = viewModel,
            onSelectOrder = onSelectOrder,
            onNavigate = onNavigate,
            searchVisible = homeSearchVisible,
            searchQuery = homeSearchQuery,
            onSearchQueryChange = onHomeSearchQueryChange,
            selectedStatus = homeStatusFilter,
            onStatusChange = onHomeStatusFilterChange,
            onClearFilters = onClearHomeFilters,
        )
        Destination.ORDERS -> OrdersScreen(
            state,
            viewModel,
            onSelectOrder,
            onNavigate,
            orderSearchQuery,
            onOrderSearchQueryChange,
            orderStatusFilter,
            onOrderStatusFilterChange,
        )
        Destination.RETURNS -> ReturnsScreen(state, viewModel, onSelectOrder, onNavigate)
        Destination.COLLECTIONS -> CollectionsScreen(state, viewModel)
        Destination.NOTIFICATIONS -> NotificationsScreen(state, viewModel, onSelectOrder)
        Destination.SETTINGS -> SettingsScreen(state, viewModel, onNavigate, onRequestNotifications, onBiometricAuth)
        Destination.USERS -> UsersScreen(state, viewModel)
        Destination.BROADCAST -> BroadcastScreen(state, viewModel)
        Destination.PARCEL_CODES -> ParcelCodeBatchesScreen(state, viewModel) { onNavigate(Destination.HOME) }
        Destination.TRASH -> TrashScreen(state, viewModel, onSelectOrder)
        Destination.PROFILE -> ProfileScreen(state, viewModel) { onNavigate(Destination.HOME) }
        Destination.NEW_ORDER -> key(newOrderFormVersion) {
            NewOrderScreen(state, viewModel, onBack = { onNavigate(Destination.HOME) }, onDone = onSelectOrder)
        }
        Destination.ORDER_DETAIL -> OrderDetailScreen(state, viewModel, selectedOrderId, onScanCode) { onNavigate(Destination.ORDERS) }
        Destination.SCAN -> ScanScreen(state, viewModel, onScanCode, onSelectOrder)
        Destination.LEGAL -> LegalScreen { onNavigate(Destination.SETTINGS) }
        Destination.HELP_CENTER -> HelpCenterScreen { onNavigate(Destination.SETTINGS) }
    }
}

@Composable
private fun AppBottomBar(destination: Destination, role: Role, onNavigate: (Destination) -> Unit) {
    val entries = if (role == Role.COURIER) {
        listOf(Destination.HOME, Destination.ORDERS, Destination.COLLECTIONS, Destination.SCAN)
    } else {
        listOf(Destination.HOME, Destination.ORDERS, Destination.COLLECTIONS, Destination.RETURNS)
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 12.dp,
    ) {
        NavigationBar(
            modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp),
            containerColor = Color.Transparent,
            tonalElevation = 0.dp,
        ) {
            entries.forEach { item ->
                NavigationBarItem(
                    selected = destination == item,
                    onClick = { onNavigate(item) },
                    icon = { Icon(item.icon, item.label, Modifier.size(22.dp)) },
                    label = { Text(item.label, style = MaterialTheme.typography.labelSmall) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
        }
    }
}

@Composable
private fun AppDrawer(
    user: UserItem,
    destination: Destination,
    onNavigate: (Destination) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().padding(vertical = 14.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(58.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = .55f)),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        if (user.role == Role.ADMIN) Icons.Outlined.AdminPanelSettings else Icons.Outlined.AccountCircle,
                        null,
                        Modifier.size(32.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                Text(user.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                Text(user.store.ifBlank { user.email }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    when (user.role) {
                        Role.ADMIN -> "حساب الإدارة"
                        Role.COURIER -> "مندوب / موظف"
                        Role.MERCHANT -> user.membership.arabic
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        NavigationDrawerItem(
            label = { Text(Destination.PROFILE.label, style = MaterialTheme.typography.bodyMedium) },
            selected = destination == Destination.PROFILE,
            onClick = { onNavigate(Destination.PROFILE) },
            icon = { Icon(Destination.PROFILE.icon, null, Modifier.size(21.dp)) },
            shape = RoundedCornerShape(8.dp),
            colors = NavigationDrawerItemDefaults.colors(
                selectedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                selectedIconColor = MaterialTheme.colorScheme.primary,
                selectedTextColor = MaterialTheme.colorScheme.onSurface,
                unselectedIconColor = MaterialTheme.colorScheme.primary,
                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 1.dp),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .5f))
        val items = buildList {
            add(Destination.HOME)
            add(Destination.ORDERS)
            if (user.role == Role.ADMIN) { add(Destination.USERS); add(Destination.BROADCAST); add(Destination.PARCEL_CODES) }
            if (user.role == Role.COURIER) add(Destination.SCAN)
            add(Destination.SETTINGS)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            items.forEach { item ->
                NavigationDrawerItem(
                    label = { Text(item.label, style = MaterialTheme.typography.bodyMedium) },
                    selected = destination == item,
                    onClick = { onNavigate(item) },
                    icon = { Icon(item.icon, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(8.dp),
                    colors = NavigationDrawerItemDefaults.colors(
                        selectedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        selectedIconColor = MaterialTheme.colorScheme.primary,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        unselectedIconColor = MaterialTheme.colorScheme.primary,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 1.dp),
                )
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .5f))
        NavigationDrawerItem(
            label = { Text("تسجيل الخروج") },
            selected = false,
            onClick = onLogout,
            icon = { Icon(Icons.AutoMirrored.Outlined.Logout, null) },
            shape = RoundedCornerShape(8.dp),
            colors = NavigationDrawerItemDefaults.colors(
                unselectedIconColor = MaterialTheme.colorScheme.error,
                unselectedTextColor = MaterialTheme.colorScheme.error,
            ),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
        Text(
            "تطبيق Android ${BuildConfig.VERSION_NAME} · بيانات الموقع المباشرة",
            Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun OfflineBanner(onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "أنت دون اتصال — تظهر آخر بيانات محفوظة.",
            Modifier.weight(1f),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall,
        )
        androidx.compose.material3.TextButton(onClick = onRetry) { Text("إعادة المحاولة") }
    }
}
