import XCTest
@testable import AlmadinaCore

final class AlmadinaCoreTests: XCTestCase {
    private func deletionPayload(eligible: Bool = false) -> JObject {
        ["request": .null,
         "eligibility": .object(["eligible": .bool(eligible), "activeOrderCount": .number(eligible ? 0 : 2), "unsettledCollectionCount": .number(eligible ? 0 : 1), "unsettledOrderCount": .number(eligible ? 0 : 3)]),
         "policy": .object(["reviewDays": 7, "reviewTimeline": "تُراجع الطلبات خلال 7 أيام.", "retentionNotice": "تُحفظ سجلات التسوية اللازمة."])]
    }
    func testDeletionRequestAcknowledgementDoesNotMeanAccountDeleted() throws {
        let receipt: JObject = ["id": "deletion-test", "status": "pending", "createdAt": "2026-09-07T00:00:00Z", "reviewDueAt": "2026-09-14T00:00:00Z", "message": "يلزم تسوية فاتورة."]
        let pending = try AccountDeletionState(deletionPayload().setting("request", .object(receipt)))
        XCTAssertEqual(pending.request?.id, "deletion-test")
        XCTAssertEqual(pending.requestStatusTitle, "تم استلام الطلب")
        XCTAssertFalse(pending.eligible)
        XCTAssertEqual(pending.activeOrderCount, 2)
        XCTAssertEqual(pending.unsettledCollectionCount, 1)
        XCTAssertEqual(pending.unsettledOrderCount, 3)
        XCTAssertEqual(pending.request?.s("message"), "يلزم تسوية فاتورة.")
        let complete = try AccountDeletionState(deletionPayload().setting("request", .object(receipt.setting("status", "completed"))))
        XCTAssertEqual(complete.requestStatusTitle, "اكتمل حذف الحساب")
        XCTAssertNotEqual(pending.requestStatusTitle, complete.requestStatusTitle)
    }
    func testDeletionImmediateEligibilityRequiresExplicitServerAcknowledgement() throws {
        let state = try AccountDeletionState(deletionPayload(eligible: true))
        XCTAssertNil(state.request)
        XCTAssertTrue(state.eligible)
        XCTAssertThrowsError(try AccountDeletionState(deletionPayload().setting("eligibility", .object([:]))))
        XCTAssertThrowsError(try AccountDeletionState(deletionPayload().setting("eligibility", .object(["eligible": "true"]))))
    }
    func testDeletionRequestRejectsMissingOrUnknownReceiptRatherThanShowingSuccess() throws {
        var missing = deletionPayload(); missing.removeValue(forKey: "request")
        XCTAssertThrowsError(try AccountDeletionState(missing))
        let invalidReceipts: [JObject] = [[:], ["id": "x", "status": "unknown"], ["id": "x", "status": "pending", "createdAt": "today"]]
        for receipt in invalidReceipts {
            XCTAssertThrowsError(try AccountDeletionState(deletionPayload().setting("request", .object(receipt))))
        }
        XCTAssertThrowsError(try AccountDeletionState(deletionPayload().setting("policy", .object([:]))))
    }
    func testDeletionRejectsIncompleteOrContradictorySettlementCounts() throws {
        var value = deletionPayload(eligible: true)
        value["eligibility"] = .object(["eligible": true, "activeOrderCount": 1, "unsettledCollectionCount": 0, "unsettledOrderCount": 0])
        XCTAssertFalse(try AccountDeletionState(value).eligible)
        for bad in [JSONValue.null, .number(-1), .number(0.5), .string("0")] {
            value["eligibility"] = .object(["eligible": true, "activeOrderCount": bad, "unsettledCollectionCount": 0, "unsettledOrderCount": 0])
            XCTAssertThrowsError(try AccountDeletionState(value))
        }
        value["eligibility"] = .object(["eligible": true, "activeOrderCount": 0])
        XCTAssertThrowsError(try AccountDeletionState(value))
    }
    func testAPIDestinationsRemainInsideTheConfiguredHTTPSService() {
        let base = URL(string: "https://service.example/api/almadina/")!
        XCTAssertEqual(APIEndpoint.resolve(base: base, path: "session")?.absoluteString, "https://service.example/api/almadina/session")
        XCTAssertNotNil(APIEndpoint.resolve(base: base, path: "track?tracking=ABC%26123"))
        for path in ["https://foreign.example/login", "//foreign.example", "../private", "%2e%2e/private", "orders/../../private", "session#fragment", "\\foreign"] {
            XCTAssertNil(APIEndpoint.resolve(base: base, path: path), path)
        }
        for unsafe in ["http://service.example/api/almadina/", "https://name:secret@service.example/api/almadina/", "https://service.example/api/almadina/?target=foreign"] {
            XCTAssertNil(APIEndpoint.resolve(base: URL(string: unsafe)!, path: "session"))
        }
    }
    func testIncompleteServerSnapshotsCannotReplaceCurrentAccountData() throws {
        let database: JObject = ["users": .array([.object(["id": "m1", "role": "merchant"])]), "orders": .array([]), "collections": .array([]), "recipients": .array([]), "notices": .array([])]
        let complete: JObject = ["database": .object(database), "revision": 2, "userId": "m1"]
        XCTAssertEqual(try Snapshot(payload: complete).userId, "m1")
        for key in ["orders", "collections", "notices", "recipients"] {
            var missing = database; missing.removeValue(forKey: key)
            XCTAssertThrowsError(try Snapshot(payload: complete.setting("database", .object(missing))))
            XCTAssertThrowsError(try Snapshot(payload: complete.setting("database", .object(database.setting(key, .null)))))
        }
        XCTAssertThrowsError(try Snapshot(payload: complete.setting("userId", "another-account")))
    }
    private var merchant: Record { Record(["id": "m1", "role": "merchant", "name": "Test Merchant", "store": "Test Store", "membership": "diamond"]) }
    private func draft() -> OrderDraft {
        var value = OrderDraft()
        value.recipientName = "Test Recipient"; value.recipientPhone = "0590000000"
        value.city = "نابلس"; value.governorate = "نابلس"; value.address = "Test-only address"; value.amount = "200"
        return value
    }
    private func order(_ id: String, status: ParcelStatus = .delivered, amount: Int = 100, fee: Int = 15) -> Record {
        Record(["id": .string(id), "merchantId": "m1", "status": .string(status.rawValue), "amount": .number(Double(amount)), "deliveryFee": .number(Double(fee)), "deliveryZone": "west-bank", "governorate": "نابلس", "city": "نابلس", "deleted": false])
    }
    private func snapshot(orders: [Record] = [], invoices: [Record] = []) -> Snapshot {
        Snapshot(database: ["users": .array([.object(merchant.raw)]), "orders": .array(orders.map { .object($0.raw) }), "collections": .array(invoices.map { .object($0.raw) }), "nextCollection": 618000], revision: 3, userId: "m1")
    }
    func testTrashPurgeRequestContainsOnlyChosenIDsAndRevision() throws {
        let removed = Record(order("remove").raw.setting("deleted", true))
        let keep = Record(order("keep").raw.setting("deleted", true))
        let invoice = Record(["id": "paid", "merchantId": "m1", "status": "paid", "orderIds": .array(["remove"])])
        var value = snapshot(orders: [removed, keep], invoices: [invoice])
        value.database = try collectionVisibilityDatabase(value, id: "paid", hidden: true)
        let original = value.database
        let request = try trashPurgeRequest(value, orderIDs: ["remove"], invoiceIDs: ["paid"])
        XCTAssertEqual(request.number("revision"), 3)
        XCTAssertEqual(request.array("orderIds").map(\.string), ["remove"])
        XCTAssertEqual(request.array("invoiceIds").map(\.string), ["paid"])
        XCTAssertEqual(value.database, original, "The request must not mutate a local snapshot before the server confirms")
        XCTAssertThrowsError(try trashPurgeRequest(value, orderIDs: [], invoiceIDs: []))
        XCTAssertThrowsError(try trashPurgeRequest(value, orderIDs: ["missing"], invoiceIDs: ["paid"]))
    }
    func testTrashPurgeBlocksActiveForeignAndOutstandingSelections() throws {
        let removed = Record(order("o").raw.setting("deleted", true))
        let invoice = Record(["id": "due", "merchantId": "m1", "status": "pending", "orderIds": .array(["o"])])
        var value = snapshot(orders: [removed], invoices: [invoice])
        value.database["preferences"] = .object(["m1": .object(["hiddenCollectionIds": .array(["due"])])])
        XCTAssertFalse(value.canPurge(removed))
        XCTAssertThrowsError(try trashPurgeRequest(value, orderIDs: ["o"], invoiceIDs: []))
        XCTAssertThrowsError(try trashPurgeRequest(value, orderIDs: [], invoiceIDs: ["due"]))
        for candidate in [order("o"), Record(removed.raw.setting("merchantId", "other"))] {
            let updated = snapshot(orders: [candidate])
            XCTAssertFalse(updated.canPurge(candidate))
            XCTAssertThrowsError(try trashPurgeRequest(updated, orderIDs: ["o"], invoiceIDs: []))
        }
        value.database["users"] = .array([.object(merchant.raw.setting("role", "courier"))])
        XCTAssertFalse(value.canPurge(removed))
    }
    func testPurgedInvoicesStayOutOfTrashRetainSettlementAndCannotBeRestored() throws {
        let item = order("o")
        let invoice = Record(["id": "i", "merchantId": "m1", "status": "paid", "orderIds": .array(["o"])])
        var value = snapshot(orders: [item], invoices: [invoice])
        value.database["preferences"] = .object(["m1": .object(["hiddenCollectionIds": .array([]), "purgedCollectionIds": .array(["i"])])])
        XCTAssertEqual(value.purgedCollectionIDs, ["i"])
        XCTAssertTrue(value.visibleCollections.isEmpty)
        XCTAssertTrue(value.trashedCollectionIDs.isEmpty)
        XCTAssertTrue(alreadyInvoiced(item, invoices: value.collections))
        XCTAssertThrowsError(try collectionVisibilityDatabase(value, id: "i", hidden: false))
        XCTAssertThrowsError(try trashPurgeRequest(value, orderIDs: [], invoiceIDs: ["i"]))
        value.database["collections"] = .array([.object(invoice.raw.setting("status", "pending"))])
        XCTAssertEqual(value.visibleCollections.map(\.id), ["i"])
        XCTAssertTrue(value.purgedCollectionIDs.isEmpty)
    }
    func testBaseFeesMatchAllMembershipsAndZones() {
        let cases: [(Membership, [Double])] = [(.standard, [25,35,80]), (.premium, [20,30,65]), (.diamond, [15,25,55])]
        for entry in cases { for (index, zone) in Zone.allCases.enumerated() { XCTAssertEqual(Pricing.baseFee(entry.0, zone), entry.1[index]) } }
    }
    func testReturnFeesMatchAllMembershipsAndZones() {
        let cases: [(Membership, [Double])] = [(.standard, [20,30,50]), (.premium, [15,25,40]), (.diamond, [10,15,25])]
        for entry in cases { for (index, zone) in Zone.allCases.enumerated() { XCTAssertEqual(Pricing.returnFee(entry.0, zone), entry.1[index]) } }
    }
    func testContentValueUsesTheOwnersAccountAndCurrentZone() throws {
        let cases: [(Membership, [Double])] = [(.standard, [75,65,20]), (.premium, [80,70,35]), (.diamond, [85,75,45])]
        var value = draft(); value.amount = "100"
        for (membership, expected) in cases {
            let owner = Record(merchant.raw.setting("membership", .string(membership.rawValue)))
            for (index, zone) in Zone.allCases.enumerated() {
                value.zone = zone
                XCTAssertEqual(try XCTUnwrap(value.contentValue(owner)), expected[index], accuracy: 0.001)
            }
        }
        XCTAssertEqual(value.amount, "100", "Showing the deduction must not reduce the collected amount a second time")
    }
    func testContentValueIncludesWeightAndEachDimensionWithArabicDecimals() throws {
        var value = draft(); value.amount = "١٠٠٫٥٠"; value.zone = .jerusalem
        value.weight = "10 - 20 كغم"; value.length = "٤١"; value.width = "٦١"; value.height = "٤٠"
        XCTAssertEqual(try XCTUnwrap(value.contentValue(merchant)), 44.5, accuracy: 0.001)
        value.weight = Pricing.weights[0]; value.length = ""; value.width = ""; value.height = ""
        XCTAssertEqual(try XCTUnwrap(value.contentValue(merchant)), 75.5, accuracy: 0.001)
    }
    func testContentValueIsEmptyUntilValidAndNeverDisplaysDebtAsContents() {
        var value = draft()
        for input in ["", " ", "invalid", "-10", "1.2.3", "nan", "1000001"] {
            value.amount = input
            XCTAssertNil(value.contentValue(merchant))
        }
        for input in ["0", "10", "15"] {
            value.amount = input
            XCTAssertEqual(value.contentValue(merchant), 0)
        }
        value = OrderDraft()
        XCTAssertNil(value.contentValue(merchant), "Clearing the draft also clears the calculated field")
    }
    func testNoOversizeFeeAtFortyCentimeters() { XCTAssertEqual(Pricing.sizeFee([40, 40, 40]), 0) }
    func testOversizeStepBoundaries() {
        XCTAssertEqual(Pricing.sizeFee([40.01]), 7)
        XCTAssertEqual(Pricing.sizeFee([60]), 7)
        XCTAssertEqual(Pricing.sizeFee([60.01]), 14)
        XCTAssertEqual(Pricing.sizeFee([100]), 21)
    }
    func testEachDimensionIsChargedIndependentlyWithCap() {
        XCTAssertEqual(Pricing.sizeFee([41,61,81]), 42)
        XCTAssertEqual(Pricing.sizeFee([1000,1000,1000]), 84)
    }
    func testOptionalAndNonFiniteDimensionsDoNotPoisonPricing() {
        XCTAssertEqual(Pricing.sizeFee([nil, 0, -1, Double.infinity, Double.nan]), 0)
    }
    func testAllWeightBands() {
        for (index, weight) in Pricing.weights.enumerated() { XCTAssertEqual(Pricing.calculate(.diamond, .westBank, weight, []).weight, Double(index * 5)) }
    }
    func testPricingCombinesBaseWeightAndDimensions() {
        let result = Pricing.calculate(.diamond, .jerusalem, "10 - 20 كغم", [41,61,40])
        XCTAssertEqual(result.base, 25); XCTAssertEqual(result.weight, 10); XCTAssertEqual(result.size, 21); XCTAssertEqual(result.total, 56)
    }
    func testArabicNumbersAndDecimals() {
        XCTAssertEqual(normalizedDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹"), "0123456789 0123456789")
        XCTAssertEqual(decimalValue(" ٤٠٫٥ "), 40.5)
        XCTAssertEqual(decimalValue("40,5"), 40.5)
    }
    func testInvalidAmountsRejected() {
        for value in ["", "nan", "inf", "-1", "12x", "1.2.3"] { XCTAssertNil(decimalValue(value)) }
        var value = draft(); value.amount = "1000001"; XCTAssertThrowsError(try value.validate())
    }
    func testTrackingCodeNormalization() {
        XCTAssertEqual(normalizedCode(" alx-٢٠٢٠٠٠١١ \n"), "ALX-20200011")
        XCTAssertEqual(normalizedCode("٢٠٢٠٠٠١١"), "ALX-20200011")
        XCTAssertTrue(validCode("ALX-000001"))
    }
    func testQRCannotBecomeArbitraryURLOrPath() {
        for code in ["", "https://example.test/ALX-000001", "javascript:alert(1)", "../../000001", "ALX-123", "ALX-000001?tracking=x", "ALX-000001<script>", "ALX-123456789012345678901"] { XCTAssertFalse(validCode(code)) }
    }
    func testPhoneAndPasswordRules() {
        XCTAssertTrue(validPhone("٠٥٩٠٠٠٠٠٠٠")); XCTAssertFalse(validPhone("1234"))
        XCTAssertTrue(validPassword("TestOnly9!")); XCTAssertFalse(validPassword("password9")); XCTAssertFalse(validPassword("short!"))
        XCTAssertTrue(validEmail("test@example.invalid")); XCTAssertFalse(validEmail("test@"))
    }
    func testNewOrderCodeIsEmptyAndRetryIDStable() throws {
        let value = draft()
        let first = try value.newOrder(user: merchant), retry = try value.newOrder(user: merchant)
        XCTAssertEqual(first.text("id"), retry.text("id"))
        XCTAssertEqual(first.text("trackingNumber"), "")
        XCTAssertEqual(first.text("status"), "draft")
        XCTAssertEqual(first.text("merchantId"), "m1")
    }
    func testPreferredDateUsesBackendFieldName() throws {
        var value = draft(); value.preferredDate = "2026-10-10"
        let raw = try value.fields(user: merchant)
        XCTAssertEqual(raw.text("preferredDeliveryDate"), "2026-10-10")
        XCTAssertNil(raw["preferredDate"])
    }
    func testNewOrderUsesServerSupportedGovernorate() throws {
        let raw = try draft().fields(user: merchant)
        XCTAssertEqual(raw.text("governorate"), "نابلس")
        XCTAssertEqual(raw.text("deliveryZone"), "west-bank")
    }
    func testDraftRejectsInvalidMeasurements() {
        for measurement in ["-1", "0", "NaN", "10001", "bad"] { var value = draft(); value.length = measurement; XCTAssertThrowsError(try value.validate()) }
    }
    func testMissingDimensionsStayEmptyWhenEditing() {
        let value = OrderDraft(order: Record(["id": "a", "lengthCm": .null, "widthCm": 0]))
        XCTAssertEqual(value.length, ""); XCTAssertEqual(value.width, ""); XCTAssertEqual(value.height, "")
    }
    func testSnapshotRejectsMissingOrFractionalRevisionAndUnknownRole() {
        XCTAssertThrowsError(try Snapshot(payload: ["database": .object([:]), "userId": "m1"]))
        XCTAssertThrowsError(try Snapshot(payload: ["database": .object(snapshot().database), "revision": .number(1.5), "userId": "m1"]))
        XCTAssertThrowsError(try Snapshot(payload: ["database": .object(["users": .array([.object(["id": "x", "role": "untrusted"])])]), "revision": 0, "userId": "x"]))
    }
    func testSnapshotRoundTripPreservesUnknownFieldsAndTypes() throws {
        var value = snapshot(); value.database["futureFeature"] = .object(["nested": .array([true, 17, "keep", .null])])
        let result = try JSONDecoder().decode(Snapshot.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(result, value)
        XCTAssertEqual(value.database.replacing("orders", id: "missing") { $0 }.text("unused"), "")
    }
    func testAssignmentIsOwnerOrAdminOnlyAndNeverOverwritesCode() {
        let current = snapshot()
        let own = order("o1", status: .draft)
        XCTAssertTrue(current.canAssign(own))
        XCTAssertFalse(current.canAssign(Record(own.raw.setting("merchantId", "other"))))
        XCTAssertFalse(current.canAssign(Record(own.raw.setting("trackingNumber", "ALX-000001"))))
        XCTAssertFalse(current.canAssign(Record(own.raw.setting("deleted", true))))
        var courier = current; courier.database["users"] = .array([.object(merchant.raw.setting("role", "courier"))])
        XCTAssertFalse(courier.canAssign(own)); XCTAssertFalse(courier.canTrash(own))
    }
    func testInvoiceEligibilityExcludesOpenInvoices() {
        let item = order("o1")
        let invoice = Record(["id": "i1", "status": "pending", "orderIds": .array(["o1"])])
        XCTAssertTrue(alreadyInvoiced(item, invoices: [invoice]))
        XCTAssertTrue(collectionCandidates(snapshot(orders: [item], invoices: [invoice])).isEmpty)
    }
    func testHiddenInvoicePreservesSettlementAndCannotBillShipmentAgain() throws {
        let invoice = Record(["id": "i1", "merchantId": "m1", "status": "paid", "orderIds": .array(["o1"]), "netAmount": 85, "paidAt": "2026-09-06T00:00:00Z"])
        var original = snapshot(orders: [order("o1")], invoices: [invoice])
        original.database["preferences"] = .object(["m1": .object(["sounds": false, "custom": "preserve"]), "other": .object(["hiddenCollectionIds": .array(["i2"])])])
        var hidden = original
        hidden.database = try collectionVisibilityDatabase(original, id: "i1", hidden: true)
        XCTAssertTrue(hidden.visibleCollections.isEmpty)
        XCTAssertEqual(hidden.database["collections"], original.database["collections"])
        XCTAssertTrue(collectionCandidates(hidden).isEmpty)
        XCTAssertEqual(hidden.database["preferences"]?.object["other"], original.database["preferences"]?.object["other"])
        XCTAssertEqual(hidden.database["preferences"]?.object["m1"]?.object["sounds"], false)
        XCTAssertEqual(hidden.database["preferences"]?.object["m1"]?.object["custom"], "preserve")
        let retried = try collectionVisibilityDatabase(hidden, id: "i1", hidden: true)
        XCTAssertEqual(retried, hidden.database)
        hidden.database = try collectionVisibilityDatabase(hidden, id: "i1", hidden: false)
        XCTAssertEqual(hidden.visibleCollections.map(\.id), ["i1"])
        XCTAssertTrue(collectionCandidates(hidden).isEmpty)
    }
    func testInvoiceListDeletionRejectsOtherMerchantAndCourier() throws {
        let invoice = Record(["id": "i1", "merchantId": "other", "status": "paid"])
        var value = snapshot(invoices: [invoice])
        XCTAssertThrowsError(try collectionVisibilityDatabase(value, id: "i1", hidden: true))
        value.database["users"] = .array([.object(merchant.raw.setting("role", "courier"))])
        XCTAssertThrowsError(try collectionVisibilityDatabase(value, id: "i1", hidden: true))
        value.database["users"] = .array([.object(merchant.raw.setting("role", "admin"))])
        XCTAssertNoThrow(try collectionVisibilityDatabase(value, id: "i1", hidden: true))
        XCTAssertThrowsError(try collectionVisibilityDatabase(value, id: "missing", hidden: true))
    }
    func testReshippedOrderIsEligibleAfterPriorPaidInvoice() {
        let item = Record(order("o1").raw.setting("shippedAt", "2026-09-05T12:00:00Z"))
        let invoice = Record(["id": "i1", "status": "paid", "orderIds": .array(["o1"]), "paidAt": "2026-09-01T12:00:00Z"])
        XCTAssertFalse(alreadyInvoiced(item, invoices: [invoice]))
        XCTAssertEqual(collectionCandidates(snapshot(orders: [item], invoices: [invoice])).count, 1)
    }
    func testOutstandingInvoicesCannotBeHiddenAndLegacyEntriesReappear() throws {
        for role in ["merchant", "admin"] {
            for status in ["pending", "ready", "unknown"] {
                for amount in [-75, 0, 75] {
                    let invoice = Record(["id": "due", "merchantId": "m1", "status": .string(status), "netAmount": .number(Double(amount))])
                    var value = snapshot(invoices: [invoice])
                    value.database["users"] = .array([.object(merchant.raw.setting("role", .string(role)))])
                    value.database["preferences"] = .object(["m1": .object(["hiddenCollectionIds": .array(["due"])])])
                    XCTAssertFalse(value.canHideCollection(invoice))
                    XCTAssertThrowsError(try collectionVisibilityDatabase(value, id: "due", hidden: true))
                    XCTAssertEqual(value.visibleCollections.map(\.id), ["due"])
                    XCTAssertTrue(value.hiddenCollectionIDs.isEmpty)
                    XCTAssertNoThrow(try collectionVisibilityDatabase(value, id: "due", hidden: false))
                    let paid = Record(invoice.raw.setting("status", "paid"))
                    XCTAssertTrue(value.canHideCollection(paid))
                }
            }
        }
    }
    func testSnapshotDerivedListsFollowDatabaseEditsAndDecoding() throws {
        var value = snapshot(orders: [order("old")])
        let newer = Record(order("new").raw.setting("createdAt", "2027-01-01T00:00:00Z"))
        value.database["orders"] = .array([.object(order("old").raw), .object(newer.raw)])
        XCTAssertEqual(value.orders.map(\.id), ["new", "old"])
        let bytes = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(Snapshot.self, from: bytes)
        XCTAssertEqual(decoded.orders, value.orders)
        XCTAssertEqual(decoded.currentUser, value.currentUser)
        let raw = try JSONDecoder().decode(JObject.self, from: bytes)
        XCTAssertEqual(Set(raw.keys), Set(["database", "revision", "userId"]))
    }
    func testSettledShipmentAndUnknownSettlementDateStayIneligible() {
        let item = Record(order("o1").raw.setting("shippedAt", "2026-09-01T12:00:00Z"))
        let paid = Record(["status": "paid", "orderIds": .array(["o1"]), "paidAt": "2026-09-05T12:00:00Z"])
        XCTAssertTrue(alreadyInvoiced(item, invoices: [paid]))
        XCTAssertTrue(alreadyInvoiced(item, invoices: [Record(paid.raw.setting("paidAt", ""))]))
    }
    func testInvoiceFeesAndNetDoNotIncludeReturnedCOD() throws {
        let current = snapshot(orders: [order("delivered", amount: 200), order("returned", status: .returned, amount: 300)])
        let result = try collectionDatabase(current, selectedIDs: ["delivered", "returned"], id: "new", code: "1234")
        let invoice = try XCTUnwrap(result.records("collections").first)
        XCTAssertEqual(invoice.n("grossAmount"), 200); XCTAssertEqual(invoice.n("deliveryFees"), 15)
        XCTAssertEqual(invoice.n("returnFees"), 10); XCTAssertEqual(invoice.n("netAmount"), 175)
        XCTAssertEqual(invoice.s("status"), "pending"); XCTAssertEqual(result.number("nextCollection"), 618001)
    }
    func testInvoiceRejectsStaleSelection() {
        XCTAssertThrowsError(try collectionDatabase(snapshot(orders: [order("shipped", status: .shipped)]), selectedIDs: ["shipped"], id: "new", code: "1234"))
        XCTAssertThrowsError(try collectionDatabase(snapshot(), selectedIDs: [], id: "new", code: "1234"))
    }
    func testMoneyAlwaysDisplaysPositiveWithDirectionalLabel() {
        XCTAssertEqual(money(-10), money(10)); XCTAssertEqual(dueTitle(-10), "مستحق للشركة")
        XCTAssertEqual(invoiceTitle("paid"), "تم التسليم")
    }
    func testBatchCodesAndBounds() throws {
        XCTAssertEqual(try batchCodes(Record(["startNumber": 20200663, "count": 3])), ["ALX-20200663", "ALX-20200664", "ALX-20200665"])
        XCTAssertEqual(try batchCodes(Record(["startNumber": 1, "count": 1])), ["ALX-000001"])
        for count in [0, 501, -1] { XCTAssertThrowsError(try batchCodes(Record(["startNumber": 1, "count": .number(Double(count))]))) }
        XCTAssertThrowsError(try batchCodes(Record(["startNumber": -1, "count": 1])))
    }
    func testTrashExpiryExactlyAfterThirtyDays() throws {
        let deletedAt = try XCTUnwrap(parseDate("2026-08-01T00:00:00Z"))
        let item = Record(order("o1").raw.setting("deleted", true).setting("deletedAt", "2026-08-01T00:00:00Z"))
        XCTAssertFalse(trashExpired(item, now: deletedAt.addingTimeInterval(30 * 86400 - 1)))
        XCTAssertTrue(trashExpired(item, now: deletedAt.addingTimeInterval(30 * 86400)))
        XCTAssertFalse(trashExpired(order("active"), now: deletedAt.addingTimeInterval(99 * 86400)))
    }
    func testLegacyTrashGetsTimestampAndClaimIsNeverRecycled() throws {
        let now = try XCTUnwrap(parseDate("2026-09-06T00:00:00Z"))
        let expired = order("expired").raw.setting("deleted", true).setting("deletedAt", "2026-01-01T00:00:00Z")
        let legacy = order("legacy").raw.setting("deleted", true)
        let database: JObject = ["orders": .array([.object(expired), .object(legacy)]), "parcelCodeClaims": .object(["ALX-000001": .object(["orderId": "expired"])])]
        let result = applyingTrashRetention(database, now: now)
        XCTAssertEqual(result.records("orders").map(\.id), ["legacy"])
        XCTAssertEqual(result.records("orders").first?.s("deletedAt"), "2026-09-06T00:00:00Z")
        XCTAssertEqual(result["parcelCodeClaims"], database["parcelCodeClaims"])
    }
    func testCSVHandlesQuotedCommasNewlinesAndBOM() throws {
        XCTAssertEqual(try ParcelCSV.parse("\u{FEFF}a,b\r\n\"x,y\",\"line 1\nline 2\"\r\n"), [["a","b"], ["x,y","line 1\nline 2"]])
        XCTAssertEqual(try ParcelCSV.parse("a\n\"He said \"\"Hi\"\"\""), [["a"], ["He said \"Hi\""]])
    }
    func testCSVRejectsMalformedOrHeaderOnlyData() {
        XCTAssertThrowsError(try ParcelCSV.parse("a\n\"unterminated"))
        XCTAssertThrowsError(try ParcelCSV.parse("a\n\"closed\"invalid"))
        XCTAssertThrowsError(try ParcelCSV.drafts(ParcelCSV.template()))
        XCTAssertThrowsError(try ParcelCSV.drafts("recipientName,recipientName\na,b"))
    }
    func testCSVImportsDraftsWithoutUsingCodeColumn() throws {
        let source = "recipientName,recipientPhone,city,address,amount,trackingNumber\nTest Recipient,0590000000,نابلس,Test-only address,100,ALX-999999"
        let values = try ParcelCSV.drafts(source)
        XCTAssertEqual(values.count, 1)
        XCTAssertEqual(try values[0].newOrder(user: merchant).text("trackingNumber"), "")
        XCTAssertNotEqual(values[0].id, "ALX-999999")
    }
    func testCSVExportNeutralizesSpreadsheetFormulaInjection() {
        let result = ParcelCSV.export([Record(order("o1").raw.setting("recipientName", "  =2+2").setting("address", "@SUM(1,2)"))])
        XCTAssertTrue(result.contains("\"'  =2+2\"")); XCTAssertTrue(result.contains("\"'@SUM(1,2)\""))
    }
    func testLocalityListAndRegionSelectionMatchBackend() {
        XCTAssertEqual(DeliveryLocations.regions.count, 12)
        XCTAssertGreaterThan(DeliveryLocations.regions.reduce(0) { $0 + $1.cities.count }, 1000)
        XCTAssertEqual(DeliveryLocations.resolve(governorate: "نابلس", city: "نابلس", zone: .westBank)?.name, "نابلس")
        XCTAssertNil(DeliveryLocations.resolve(governorate: "القدس", city: "القدس", zone: .westBank))
        XCTAssertEqual(DeliveryLocations.resolve(governorate: "القدس", city: "القدس", zone: .jerusalem)?.name, "القدس")
        XCTAssertNil(DeliveryLocations.resolve(governorate: "", city: "غير موجودة", zone: .westBank))
    }
    func testNormalizedLocalityAcceptsEquivalentArabicSpelling() {
        XCTAssertEqual(DeliveryLocations.normalize("أريحا"), DeliveryLocations.normalize("اريحا"))
        XCTAssertEqual(DeliveryLocations.normalize("بدّو"), DeliveryLocations.normalize("بدو"))
    }
}
