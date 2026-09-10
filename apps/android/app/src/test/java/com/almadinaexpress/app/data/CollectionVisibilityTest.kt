package com.almadinaexpress.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class CollectionVisibilityTest {
    private fun fixture(role: String = "merchant"): SessionSnapshot {
        val raw = Json.parseToJsonElement("""
            {"users":[{"id":"m1","role":"$role","name":"Test"}],
             "orders":[{"id":"o1","merchantId":"m1","status":"delivered","shippedAt":"2026-09-01T00:00:00Z"}],
             "collections":[{"id":"i1","merchantId":"m1","status":"paid","orderIds":["o1"],"paidAt":"2026-09-05T00:00:00Z","netAmount":85}],
             "preferences":{"m1":{"sounds":false,"custom":"preserve"},"other":{"hiddenCollectionIds":["i2"]}}}
        """).jsonObject
        return SessionSnapshot(raw, 3, "m1")
    }

    @Test fun deletionKeepsSettlementAndRestorationNeverReopensBilling() {
        val original = fixture()
        val hidden = original.copy(database = collectionVisibilityDatabase(original, "i1", true))
        assertTrue(hidden.visibleCollections.isEmpty())
        assertEquals(original.database["collections"], hidden.database["collections"])
        assertTrue(isOrderInvoicedForCurrentShipment(hidden.orders.first(), hidden.collections))
        val prefs = hidden.database["preferences"]!!.jsonObject
        assertEquals(original.database["preferences"]!!.jsonObject["other"], prefs["other"])
        assertEquals(false, prefs["m1"]!!.jsonObject.flag("sounds"))
        assertEquals("preserve", prefs["m1"]!!.jsonObject.string("custom"))
        assertEquals(hidden.database, collectionVisibilityDatabase(hidden, "i1", true))
        val restored = hidden.copy(database = collectionVisibilityDatabase(hidden, "i1", false))
        assertEquals(listOf("i1"), restored.visibleCollections.map { it.id })
        assertTrue(isOrderInvoicedForCurrentShipment(restored.orders.first(), restored.collections))
    }

    @Test fun onlyOwnerOrAdminCanDeleteAndCourierCannotTrashParcels() {
        val courier = fixture("courier")
        assertFalse(courier.canTrash(courier.orders.first()))
        assertThrows(IllegalArgumentException::class.java) { collectionVisibilityDatabase(courier, "i1", true) }
        val owner = fixture()
        val othersInvoice = owner.collections.first().raw.updated("merchantId" to text("other"))
        val other = owner.copy(database = owner.database.updated("collections" to JsonArray(listOf(othersInvoice))))
        assertThrows(IllegalArgumentException::class.java) { collectionVisibilityDatabase(other, "i1", true) }
        assertThrows(IllegalArgumentException::class.java) { collectionVisibilityDatabase(owner, "missing", true) }
        assertTrue(fixture("admin").canHideCollection(other.collections.first()))
    }
    @Test fun outstandingInvoicesStayVisibleEvenWhenAnOlderClientHidThem() {
        for (role in listOf("merchant", "admin")) for (status in listOf("pending", "ready", "unknown")) for (amount in listOf(-75, 0, 75)) {
            val original = fixture(role)
            val invoice = original.collections.first().raw.updated("status" to text(status), "netAmount" to number(amount))
            val prefs = original.database["preferences"]!!.jsonObject
            val db = original.database.updated(
                "collections" to JsonArray(listOf(invoice)),
                "preferences" to prefs.updated("m1" to prefs["m1"]!!.jsonObject.updated("hiddenCollectionIds" to JsonArray(listOf(text("i1"))))),
            )
            val snapshot = original.copy(database = db)
            assertFalse(snapshot.canHideCollection(snapshot.collections.first()))
            assertThrows(IllegalArgumentException::class.java) { collectionVisibilityDatabase(snapshot, "i1", true) }
            assertEquals(listOf("i1"), snapshot.visibleCollections.map { it.id })
            assertTrue(snapshot.hiddenCollectionIds.isEmpty())
            val restored = collectionVisibilityDatabase(snapshot, "i1", false)
            assertEquals(db["collections"], restored["collections"])
        }
    }
    private fun trashFixture(): SessionSnapshot {
        val original = fixture()
        val removed = original.orders.first().raw.updated("deleted" to bool(true))
        return original.copy(database = collectionVisibilityDatabase(original, "i1", true).updated("orders" to JsonArray(listOf(removed))))
    }
    @Test fun purgeRequestIncludesOnlySelectedIdsWithoutOptimisticDeletion() {
        val current = trashFixture()
        val before = current.database.toString()
        val request = trashPurgeRequest(current, setOf("o1"), setOf("i1"))
        assertEquals(3, request.integer("revision"))
        assertEquals(listOf("o1"), request.array("orderIds").map { it.toString().trim('"') })
        assertEquals(listOf("i1"), request.array("invoiceIds").map { it.toString().trim('"') })
        assertEquals(before, current.database.toString())
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(current, emptySet(), emptySet()) }
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(current, setOf("missing"), setOf("i1")) }
    }
    @Test fun purgeRejectsActiveForeignCourierAndOutstandingItems() {
        val original = trashFixture()
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(fixture(), setOf("o1"), emptySet()) }
        val foreignOrder = original.orders.first().raw.updated("merchantId" to text("other"))
        val foreign = original.copy(database = original.database.updated("orders" to JsonArray(listOf(foreignOrder))))
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(foreign, setOf("o1"), emptySet()) }
        val due = original.collections.first().raw.updated("status" to text("pending"))
        val pending = original.copy(database = original.database.updated("collections" to JsonArray(listOf(due))))
        assertFalse(pending.canPurge(pending.orders.first()))
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(pending, setOf("o1"), emptySet()) }
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(pending, emptySet(), setOf("i1")) }
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(fixture("courier"), setOf("o1"), emptySet()) }
    }
    @Test fun purgedInvoiceCannotBeRestoredButStillProtectsAgainstDoubleBilling() {
        val current = trashFixture()
        val prefs = current.database["preferences"]!!.jsonObject
        val purged = current.copy(database = current.database.updated("preferences" to prefs.updated(
            "m1" to prefs["m1"]!!.jsonObject.updated("hiddenCollectionIds" to JsonArray(emptyList()), "purgedCollectionIds" to JsonArray(listOf(text("i1")))))))
        assertEquals(setOf("i1"), purged.purgedCollectionIds)
        assertTrue(purged.visibleCollections.isEmpty())
        assertTrue(purged.trashedCollectionIds.isEmpty())
        assertTrue(isOrderInvoicedForCurrentShipment(purged.orders.first(), purged.collections))
        assertThrows(IllegalArgumentException::class.java) { collectionVisibilityDatabase(purged, "i1", false) }
        assertThrows(IllegalArgumentException::class.java) { trashPurgeRequest(purged, emptySet(), setOf("i1")) }
        val due = purged.collections.first().raw.updated("status" to text("pending"))
        val pending = purged.copy(database = purged.database.updated("collections" to JsonArray(listOf(due))))
        assertEquals(listOf("i1"), pending.visibleCollections.map { it.id })
        assertTrue(pending.purgedCollectionIds.isEmpty())
    }

}
