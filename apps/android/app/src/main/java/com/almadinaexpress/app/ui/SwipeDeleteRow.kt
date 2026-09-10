package com.almadinaexpress.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.almadinaexpress.app.AppViewModel
import com.almadinaexpress.app.MainUiState
import com.almadinaexpress.app.data.OrderItem
import kotlin.math.roundToInt

/** A physical left swipe reveals an action on the right, including in Arabic RTL. */
@Composable
fun SwipeDeleteRow(
    enabled: Boolean,
    title: String,
    message: String,
    onDelete: () -> Unit,
    actionLabel: String = "حذف",
    content: @Composable () -> Unit,
) {
    if (!enabled) { content(); return }
    val width = with(LocalDensity.current) { 88.dp.toPx() }
    var offset by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    val displayedOffset by animateFloatAsState(offset, if (dragging) snap() else tween(160), label = "swipeDelete")
    fun requestDelete() { offset = 0f; confirming = true }

    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))) {
        if (displayedOffset < -1f) Box(Modifier.matchParentSize().background(Color(0xFFB42335))) {
            Column(
                Modifier.align(AbsoluteAlignment.CenterRight).width(88.dp).fillMaxHeight()
                    .clickable(onClickLabel = title) { requestDelete() }.padding(8.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Outlined.DeleteOutline, contentDescription = null, tint = Color.White)
                Text(actionLabel, color = Color.White, textAlign = TextAlign.Center)
            }
        }
        Box(
            Modifier.absoluteOffset { IntOffset(displayedOffset.roundToInt(), 0) }
                .draggable(
                    state = rememberDraggableState { delta -> offset = (offset + delta).coerceIn(-width, 0f) },
                    orientation = Orientation.Horizontal,
                    reverseDirection = false,
                    onDragStarted = { dragging = true },
                    onDragStopped = { dragging = false; offset = if (offset < -width / 2f) -width else 0f },
                )
                .semantics { customActions = listOf(CustomAccessibilityAction(title) { requestDelete(); true }) },
        ) { content() }
    }
    if (confirming) AlertDialog(
        onDismissRequest = { confirming = false },
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = { confirming = false; onDelete() }) { Text(actionLabel, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirming = false }) { Text("إلغاء") } },
    )
}

@Composable
fun SwipeParcelCard(order: OrderItem, state: MainUiState, viewModel: AppViewModel, onClick: () -> Unit) {
    val allowed = state.snapshot?.canTrash(order) == true && !order.deleted && !state.busy && !state.offlineCache
    SwipeDeleteRow(
        enabled = allowed,
        title = "حذف الطرد؟",
        message = "سيُنقل الطرد إلى المحذوفات ويمكن استعادته خلال 30 يومًا.",
        onDelete = { viewModel.moveOrderToTrash(order.id) },
    ) { OrderCard(order, onClick) }
}
