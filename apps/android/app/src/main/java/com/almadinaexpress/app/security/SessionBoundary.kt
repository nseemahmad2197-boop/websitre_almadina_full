package com.almadinaexpress.app.security

import java.util.concurrent.CancellationException

/** Shared by foreground and WorkManager repositories in the same process. */
object SessionBoundary {
    private val lock = Any()
    private var epoch = 0L

    fun current(): Long = synchronized(lock) { epoch }

    fun <T> withCurrent(expected: Long, action: () -> T): T = synchronized(lock) {
        if (epoch != expected) throw CancellationException("Session changed")
        action()
    }

    fun invalidate(action: () -> Unit) = synchronized(lock) {
        epoch += 1
        action()
    }
}

fun acceptsSnapshot(currentUserId: String?, currentRevision: Int?, incomingUserId: String, incomingRevision: Int, replacingAccount: Boolean = false): Boolean =
    incomingUserId.isNotBlank() && incomingRevision >= 0 &&
        (replacingAccount || currentUserId == null || (currentUserId == incomingUserId && incomingRevision >= (currentRevision ?: 0)))
