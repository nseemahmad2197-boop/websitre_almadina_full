package com.almadinaexpress.app.security

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SessionBoundaryTest {
    @Test fun lateResponseCannotRestoreLoggedOutAccount() {
        val epoch = SessionBoundary.current()
        var stored = "old-account"
        SessionBoundary.invalidate { stored = "" }
        val newEpoch = SessionBoundary.current()
        SessionBoundary.withCurrent(newEpoch) { stored = "new-account" }
        assertThrows(CancellationException::class.java) { SessionBoundary.withCurrent(epoch) { stored = "old-account" } }
        assertEquals("new-account", stored)
    }

    @Test fun foregroundAndWorkerShareTheSameBoundary() {
        val workerEpoch = SessionBoundary.current()
        val foregroundEpoch = SessionBoundary.current()
        assertEquals(workerEpoch, foregroundEpoch)
        SessionBoundary.invalidate { }
        assertThrows(CancellationException::class.java) { SessionBoundary.withCurrent(workerEpoch) { fail("stale worker write") } }
        assertThrows(CancellationException::class.java) { SessionBoundary.withCurrent(foregroundEpoch) { fail("stale UI write") } }
    }

    @Test fun logoutClearsAnAlreadyCommittingWriteBeforeReturning() {
        val pool = Executors.newFixedThreadPool(2)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        var cached = ""
        try {
            val epoch = SessionBoundary.current()
            val writer = pool.submit { SessionBoundary.withCurrent(epoch) {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                cached = "old-data"
            } }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            val logout = pool.submit { SessionBoundary.invalidate { cached = "" } }
            release.countDown()
            writer.get(5, TimeUnit.SECONDS)
            logout.get(5, TimeUnit.SECONDS)
            assertEquals("", cached)
        } finally { release.countDown(); pool.shutdownNow() }
    }

    @Test fun olderOrForeignSnapshotsNeverReplaceCurrentData() {
        assertFalse(acceptsSnapshot("owner", 8, "owner", 7))
        assertFalse(acceptsSnapshot("owner", 8, "other", 9))
        assertFalse(acceptsSnapshot(null, null, "owner", -1))
        assertFalse(acceptsSnapshot(null, null, "", 1))
        assertTrue(acceptsSnapshot("owner", 8, "owner", 9))
        assertTrue(acceptsSnapshot("owner", 8, "owner", 8))
        assertTrue(acceptsSnapshot("owner", 8, "other", 2, replacingAccount = true))
    }
}
