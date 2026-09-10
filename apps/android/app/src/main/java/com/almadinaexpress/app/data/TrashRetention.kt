package com.almadinaexpress.app.data

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.temporal.ChronoUnit

const val TRASH_RETENTION_DAYS = 30L

data class TrashRetentionResult(
    val database: JsonObject,
    val changed: Boolean,
    val permanentlyDeleted: Int,
)

/**
 * Removes orders that have stayed in the trash for 30 days. Legacy deleted
 * orders without a deletion timestamp receive a fresh 30-day recovery window.
 */
fun applyTrashRetention(
    database: JsonObject,
    now: Instant = Instant.now(),
): TrashRetentionResult {
    var changed = false
    var permanentlyDeleted = 0
    val cutoff = now.minus(TRASH_RETENTION_DAYS, ChronoUnit.DAYS)
    val orders = database.array("orders").mapNotNull { element: JsonElement ->
        val raw = element as? JsonObject ?: return@mapNotNull element
        if (!raw.flag("deleted")) return@mapNotNull raw

        val deletedAt = raw.string("deletedAt")
        val deletedInstant = deletedAt.takeIf(String::isNotBlank)?.let { value ->
            runCatching { Instant.parse(value) }.getOrNull()
        }
        when {
            deletedInstant == null -> {
                changed = true
                raw.updated("deletedAt" to text(now.toString()))
            }
            !deletedInstant.isAfter(cutoff) -> {
                changed = true
                permanentlyDeleted += 1
                null
            }
            else -> raw
        }
    }
    val nextDatabase = if (changed) database.withArray("orders", orders) else database
    return TrashRetentionResult(nextDatabase, changed, permanentlyDeleted)
}
