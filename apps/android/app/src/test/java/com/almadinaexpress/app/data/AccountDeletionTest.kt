package com.almadinaexpress.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class AccountDeletionTest {
    private fun payload(): JsonObject = Json.parseToJsonElement("""
        {"request":{"id":"REQ-TEST","status":"pending","createdAt":"2026-09-07T12:00:00Z","updatedAt":"2026-09-07T12:00:00Z","reviewDueAt":"2026-09-14T12:00:00Z","message":"تحتاج الفاتورة إلى تسوية","receiptUrl":"https://example.test/delete-account#receipt=opaque-test"},
         "eligibility":{"activeOrderCount":1,"unsettledCollectionCount":1,"unsettledOrderCount":0,"eligible":false},
         "policy":{"reviewDays":7,"reviewTimeline":"تُراجع الطلبات خلال 7 أيام تقويمية.","retentionNotice":"تبقى بيانات التسوية المطلوبة."}}
    """).jsonObject

    @Test fun acknowledgedRequestSurvivesOutstandingParcelsAndInvoices() {
        val result = accountDeletionInfo(payload())
        assertEquals("REQ-TEST", result.request?.id)
        assertEquals("تم استلام الطلب", result.request?.statusLabel)
        assertEquals("2026-09-14T12:00:00Z", result.request?.reviewDueAt)
        assertEquals(1, result.activeOrderCount)
        assertEquals(1, result.unsettledCollectionCount)
        assertFalse(result.eligible)
    }

    @Test fun immediateDeletionNeedsServerEligibilityAndZeroObligations() {
        val original = payload()
        val ready = Json.parseToJsonElement("""{"activeOrderCount":0,"unsettledCollectionCount":0,"unsettledOrderCount":0,"eligible":true}""").jsonObject
        assertTrue(accountDeletionInfo(original.updated("eligibility" to ready)).eligible)
        for (count in listOf("activeOrderCount", "unsettledCollectionCount", "unsettledOrderCount")) {
            assertFalse(accountDeletionInfo(original.updated("eligibility" to ready.updated(count to JsonPrimitive(1)))).eligible)
        }
        assertFalse(accountDeletionInfo(original.updated("eligibility" to ready.updated("eligible" to JsonPrimitive(false)))).eligible)
        assertFalse(accountDeletionInfo(original.updated("eligibility" to JsonObject(ready - "eligible"))).eligible)
    }

    @Test fun malformedOrOldBackendResponsesDoNotEnableDeletion() {
        assertThrows(IllegalArgumentException::class.java) { accountDeletionInfo(JsonObject(emptyMap())) }
        assertThrows(IllegalArgumentException::class.java) { accountDeletionInfo(JsonObject(payload() - "policy")) }
        assertThrows(IllegalArgumentException::class.java) { accountDeletionInfo(JsonObject(payload() - "request")) }
        assertThrows(IllegalArgumentException::class.java) { accountDeletionInfo(payload().updated("request" to JsonPrimitive("invalid"))) }
        val invalid = payload()["eligibility"]!!.jsonObject.updated("activeOrderCount" to JsonPrimitive(-1))
        assertThrows(IllegalArgumentException::class.java) { accountDeletionInfo(payload().updated("eligibility" to invalid)) }
    }

    @Test fun onlySameServiceReceiptUrlsCanOpen() {
        val origin = "https://example.test"
        val valid = "$origin/delete-account#receipt=opaque-test"
        assertEquals(valid, safeDeletionReceiptUrl(valid, origin))
        for (value in listOf("https://attacker.test/delete-account#receipt=a", "http://example.test/delete-account#receipt=a", "https://name@example.test/delete-account#receipt=a", "https://example.test:8443/delete-account#receipt=a", "https://example.test/other#receipt=a", "javascript:alert(1)", "$origin/delete-account")) {
            assertNull(safeDeletionReceiptUrl(value, origin))
        }
    }
}
