import XCTest

/// Local UI fixtures never contact the service. Server-connected end-to-end
/// tests still require dedicated staging accounts.
final class AlmadinaExpressUITests: XCTestCase {
    private var app: XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-test-no-network", "-AppleLanguages", "(ar)", "-AppleLocale", "ar_PS"]
        app.launch()
    }
    override func tearDownWithError() throws { app.terminate(); app = nil }
    func testNativeLoginHasNoAutomaticPermissionPrompt() throws {
        let login = app.buttons["login.submit"]
        XCTAssertTrue(login.waitForExistence(timeout: 10))
        XCTAssertFalse(login.isEnabled)
        XCTAssertTrue(app.textFields["البريد الإلكتروني"].exists)
        XCTAssertTrue(app.secureTextFields["كلمة المرور"].exists)
        XCTAssertTrue(app.images["brand.mark"].exists)
        XCTAssertEqual(app.alerts.count, 0)
        XCTAssertEqual(app.webViews.count, 0)
    }
    func testRegistrationValidatesBeforeSending() throws {
        let register = app.buttons["login.register"]
        XCTAssertTrue(register.waitForExistence(timeout: 10))
        if !register.isHittable { app.swipeUp() }
        register.tap()
        XCTAssertTrue(app.textFields["الاسم الكامل"].waitForExistence(timeout: 5))
        app.buttons["التالي"].tap()
        XCTAssertTrue(app.staticTexts["أكمل الاسم والمتجر وبريدًا صحيحًا وجوالًا من 10 أرقام يبدأ بـ 05."].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
    }
    func testLoginCanRotateWithoutLosingControls() throws {
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["login.submit"].exists)
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.buttons["login.submit"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Native-Arabic-Login"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func assertCurrentLegalFooter() {
        XCTAssertTrue(app.navigationBars["الخصوصية والأمان"].waitForExistence(timeout: 5))
        let rule = app.staticTexts["legal.parcel-description-rule"]
        reveal(rule)
        XCTAssertEqual(rule.label, "يجب أن يكون الطرد مطابقًا للوصف المكتوب.")
        for (id, title) in [
            ("legal.privacy-link", "سياسة الخصوصية على الموقع"),
            ("legal.deletion-link", "طلب حذف الحساب ومتابعته على الموقع"),
            ("legal.support-link", "التواصل مع الدعم")
        ] {
            // SwiftUI can expose Link as a link or button across OS versions.
            let link = app.descendants(matching: .any).matching(identifier: id).firstMatch
            reveal(link)
            XCTAssertEqual(link.label, title)
        }
        let obsoleteLink = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "سياسة الخصوصية المنشورة"))
        XCTAssertEqual(obsoleteLink.count, 0)
        XCTAssertEqual(app.webViews.count, 0)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Current-legal-footer-and-official-links"
        attachment.lifetime = .keepAlways
        add(attachment)
        // External links are not opened: this fixture must stay offline.
    }
    func testLegalFooterFromLogin() throws {
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
        let legal = app.buttons["الشروط والخصوصية"]
        reveal(legal)
        legal.tap()
        assertCurrentLegalFooter()
    }
    func testLegalFooterFromSettings() throws {
        app.terminate()
        app.launchArguments.append("--ui-test-merchant")
        app.launch()
        let menu = app.buttons["القائمة الجانبية"]
        if menu.waitForExistence(timeout: 3) {
            menu.tap()
            app.buttons["navigation.settings"].tap()
        } else {
            // iPad uses the permanent sidebar instead of the iPhone menu.
            let settings = app.buttons["الإعدادات"].firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 5))
            settings.tap()
        }
        let legal = app.buttons["الشروط والخصوصية والأذونات"]
        reveal(legal)
        legal.tap()
        assertCurrentLegalFooter()
    }
    private func launchMerchant() {
        app.terminate()
        app.launchArguments.append("--ui-test-merchant")
        app.launch()
        XCTAssertTrue(app.buttons["القائمة الجانبية"].waitForExistence(timeout: 10))
    }
    func testNewOrderFloatsAtLeftAboveTabsAndOpensForm() throws {
        launchMerchant()
        let create = app.buttons["إنشاء طرد جديد"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        let tabBar = app.tabBars.firstMatch
        try XCTSkipIf(!tabBar.exists, "The iPad layout uses a sidebar; this position check targets iPhone tabs.")
        XCTAssertTrue(tabBar.exists)
        XCTAssertLessThan(create.frame.midX, app.frame.midX)
        XCTAssertGreaterThanOrEqual(create.frame.width, 44)
        XCTAssertLessThanOrEqual(create.frame.maxY, tabBar.frame.minY)
        XCTAssertLessThan(tabBar.frame.minY - create.frame.maxY, 100)
        app.swipeUp()
        XCTAssertTrue(create.isHittable)
        XCTAssertLessThanOrEqual(create.frame.maxY, tabBar.frame.minY)
        create.tap()
        XCTAssertTrue(app.textFields["اسم المستلم"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["إنشاء طرد جديد"].exists)
        XCTAssertTrue(app.tabBars.firstMatch.exists)
    }
    private func openCleanOrderForm() throws {
        launchMerchant()
        app.buttons["إنشاء طرد جديد"].tap()
        try clearOrderForm()
    }
    private func openInvoiceFixture() {
        app.launchArguments.append("--ui-test-invoices")
        launchMerchant()
        if app.tabBars.firstMatch.exists { app.tabBars.buttons["التحصيلات"].tap() }
        else { app.buttons["التحصيلات"].firstMatch.tap() }
    }
    private func invoiceRow(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "invoice.row." + id).firstMatch
    }
    func testPaidInvoiceCardsRevealDeleteOnPhysicalLeftSwipeAndCancelKeepsThem() throws {
        openInvoiceFixture()
        for id in ["ui-paid", "ui-paid-company"] {
            let row = invoiceRow(id)
            XCTAssertTrue(row.waitForExistence(timeout: 5))
            reveal(row)
            // Also test a long swipe: deletion requires tapping and confirmation.
            row.swipeLeft(velocity: .fast)
            let deletion = app.buttons["حذف الفاتورة"].firstMatch
            XCTAssertTrue(deletion.waitForExistence(timeout: 3))
            XCTAssertTrue(deletion.isHittable)
            XCTAssertTrue(row.exists)
            deletion.tap()
            XCTAssertTrue(app.staticTexts["حذف الفاتورة من قائمتك؟"].waitForExistence(timeout: 3))
            app.buttons["إلغاء"].tap()
            XCTAssertTrue(row.exists)
            XCTAssertFalse(app.staticTexts["الاتصال معطّل في اختبارات الواجهة."].exists)
        }
    }
    func testOutstandingInvoiceCardDoesNotExposeDeleteOnLeftSwipe() throws {
        openInvoiceFixture()
        let row = invoiceRow("ui-due")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        reveal(row)
        row.swipeLeft()
        XCTAssertFalse(app.buttons["حذف الفاتورة"].exists)
        XCTAssertTrue(row.exists)
        row.tap()
        XCTAssertTrue(app.navigationBars["تفاصيل التحصيل"].waitForExistence(timeout: 5))
    }
    private func clearOrderForm() throws {
        app.navigationBars.buttons["مسح جميع الحقول"].tap()
        let clear = try XCTUnwrap(app.buttons.matching(identifier: "مسح جميع الحقول").allElementsBoundByIndex.last)
        clear.tap()
    }
    private func reveal(_ element: XCUIElement) {
        for _ in 0..<8 { if element.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    private func assertValue(_ value: String, of element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let matches = NSPredicate(format: "value == %@", value)
        let ready = XCTNSPredicateExpectation(predicate: matches, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 3), .completed, file: file, line: line)
    }
    func testPhoneNumberAppearsWhileEditingOrderAndCanBeCorrected() throws {
        try openCleanOrderForm()
        let phone = app.textFields["رقم جوال المستلم"]
        XCTAssertTrue(phone.waitForExistence(timeout: 5))
        phone.tap()
        phone.typeText("0591234567")
        // Assert before moving focus; this is the reported regression.
        XCTAssertEqual(phone.value as? String, "0591234567")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        phone.typeText(XCUIKeyboardKey.delete.rawValue + "8")
        XCTAssertEqual(phone.value as? String, "0591234568")
        app.textFields["اسم المستلم"].tap()
        XCTAssertEqual(phone.value as? String, "0591234568")
    }
    func testContentValueUpdatesWhileTypingWithoutChangingTheCollectedAmount() throws {
        try openCleanOrderForm()
        let price = app.textFields["سعر الطرد"]
        reveal(price)
        price.tap()
        var typed = ""
        for digit in ["1", "0", "0"] {
            price.typeText(digit); typed += digit
            assertValue(typed, of: price)
        }
        let contents = app.staticTexts["order.content-value"]
        XCTAssertTrue(contents.waitForExistence(timeout: 5))
        assertValue("75 ₪", of: contents)
        price.typeText(XCUIKeyboardKey.delete.rawValue + "5")
        assertValue("80 ₪", of: contents)
        assertValue("105", of: price)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Price-visible-before-changing-focus"
        attachment.lifetime = .keepAlways; add(attachment)
        price.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        assertValue("تُحسب تلقائيًا", of: contents)
        price.typeText("200")
        assertValue("200", of: price)
        assertValue("175 ₪", of: contents)
    }
    func testDecimalPriceKeepsFractionAndInsertionPointWhileEditing() throws {
        try openCleanOrderForm()
        let price = app.textFields["سعر الطرد"]
        reveal(price); price.tap(); price.typeText("100")
        let separator = try XCTUnwrap([".", ",", "٫"].first { app.keyboards.keys[$0].exists })
        app.keyboards.keys[separator].tap()
        assertValue("100" + separator, of: price)
        price.typeText("50")
        assertValue("100" + separator + "50", of: price)
        assertValue("75.50 ₪", of: app.staticTexts["order.content-value"])
        // Delete a digit and continue editing without normalizing the field.
        price.typeText(XCUIKeyboardKey.delete.rawValue + "5")
        assertValue("100" + separator + "55", of: price)
        assertValue("75.55 ₪", of: app.staticTexts["order.content-value"])
    }
    func testEachDimensionUpdatesImmediatelyAndClearRemovesEditedText() throws {
        try openCleanOrderForm()
        for title in ["الطول (سم)", "العرض (سم)", "الارتفاع (سم)"] {
            let field = app.textFields[title]
            reveal(field); field.tap()
            field.typeText("4"); assertValue("4", of: field)
            field.typeText("1"); assertValue("41", of: field)
            field.typeText(XCUIKeyboardKey.delete.rawValue + "2")
            assertValue("42", of: field)
        }
        try clearOrderForm()
        let height = app.textFields["الارتفاع (سم)"]
        reveal(height); height.tap(); height.typeText("60")
        // A reset must reach UIKit, otherwise this would append to the old 42.
        assertValue("60", of: height)
    }
    func testNameAndMultilineAddressAppearBeforeChangingFocus() throws {
        try openCleanOrderForm()
        let name = app.textFields["اسم المستلم"]
        reveal(name); name.tap(); name.typeText("Naseem")
        assertValue("Naseem", of: name)
        name.typeText(XCUIKeyboardKey.delete.rawValue + "r")
        assertValue("Naseer", of: name)
        let address = app.textViews["المنطقة / الشارع / وصف العنوان"]
        reveal(address); address.tap(); address.typeText("Main road\nBuilding 5")
        assertValue("Main road\nBuilding 5", of: address)
        address.typeText(XCUIKeyboardKey.delete.rawValue + "6")
        assertValue("Main road\nBuilding 6", of: address)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
    }
    func testEmailAndSecurePasswordPublishEditsWithoutLeavingField() throws {
        let email = app.textFields["البريد الإلكتروني"]
        reveal(email); email.tap(); email.typeText("test@example.com")
        assertValue("test@example.com", of: email)
        email.typeText(XCUIKeyboardKey.delete.rawValue + "m")
        assertValue("test@example.com", of: email)
        let password = app.secureTextFields["كلمة المرور"]
        reveal(password); password.tap(); password.typeText("Test123!")
        XCTAssertTrue(app.buttons["login.submit"].isEnabled)
        XCTAssertNotEqual(password.value as? String, "Test123!")
        XCTAssertEqual(app.textFields.matching(identifier: "كلمة المرور").count, 0)
        password.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8))
        XCTAssertFalse(app.buttons["login.submit"].isEnabled)
        password.typeText("Next123!")
        XCTAssertTrue(app.buttons["login.submit"].isEnabled)
        // Do not submit or persist these synthetic credentials.
    }
    func testIntegerCountCanBeEditedWithoutChangingFocus() throws {
        app.terminate(); app.launchArguments.append("--ui-test-admin"); app.launch()
        XCTAssertTrue(app.buttons["القائمة الجانبية"].waitForExistence(timeout: 10))
        app.buttons["القائمة الجانبية"].tap()
        app.buttons["حجز أكواد الطرود"].tap()
        let count = app.textFields["عدد الأكواد (1–500)"]
        reveal(count); count.tap()
        count.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2) + "123")
        assertValue("123", of: count)
        count.typeText(XCUIKeyboardKey.delete.rawValue + "4")
        assertValue("124", of: count)
        // Editing only: no reservation request or production data.
    }
    func testDashboardSearchPublishesWhileTyping() throws {
        launchMerchant()
        let search = app.textFields["بحث في الطرود"]
        reveal(search); search.tap(); search.typeText("ALX")
        assertValue("ALX", of: search)
        XCTAssertTrue(app.staticTexts["نتائج البحث"].exists)
        search.typeText(XCUIKeyboardKey.delete.rawValue)
        assertValue("AL", of: search)
    }
    func testSupportOpensHelpFromDeleteAccountAndReturnsToForm() throws {
        launchMerchant()
        app.buttons["القائمة الجانبية"].tap()
        app.buttons["navigation.settings"].tap()
        let deletion = app.buttons["حذف الحساب"]
        for _ in 0..<5 { if deletion.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(deletion.isHittable)
        deletion.tap()
        let support = app.buttons["account.support"]
        XCTAssertTrue(support.waitForExistence(timeout: 5))
        support.tap()
        XCTAssertTrue(app.navigationBars["مركز المساعدة"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(support.waitForExistence(timeout: 5))
        XCTAssertEqual(app.alerts.count, 0)
    }
    func testRepeatedTabChangesKeepCorrectPageAndNativeControls() throws {
        launchMerchant()
        for _ in 0..<3 {
            for (tab, title) in [("الطرود", "الطرود"), ("التحصيلات", "التحصيلات"), ("الرواجع", "الرواجع"), ("الرئيسية", "لوحة المتابعة")] {
                if app.tabBars.firstMatch.exists { app.tabBars.buttons[tab].tap() }
                else { app.buttons[tab].firstMatch.tap() }
                XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
            }
        }
        XCTAssertTrue(app.buttons["إنشاء طرد جديد"].isHittable)
    }
    func testBottomTabsRemainAvailableInsidePagesAndKeepNavigation() throws {
        launchMerchant()
        // iPad uses a sidebar; this regression concerns the compact iPhone UI.
        guard app.tabBars.firstMatch.exists else { throw XCTSkip("iPhone tab-bar regression") }
        app.buttons["إنشاء طرد جديد"].tap()
        XCTAssertTrue(app.tabBars.buttons["الطرود"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["الطرود"].isHittable)
        app.tabBars.buttons["الطرود"].tap()
        XCTAssertTrue(app.navigationBars["الطرود"].waitForExistence(timeout: 5))
        app.tabBars.buttons["الرئيسية"].tap()
        XCTAssertTrue(app.textFields["اسم المستلم"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["القائمة الجانبية"].tap()
        app.buttons["navigation.settings"].tap()
        XCTAssertTrue(app.tabBars.buttons["التحصيلات"].isHittable)
        let help = app.buttons["مركز المساعدة"]
        for _ in 0..<5 { if help.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(help.isHittable)
        help.tap()
        XCTAssertTrue(app.navigationBars["مركز المساعدة"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["التحصيلات"].isHittable)
        app.tabBars.buttons["التحصيلات"].tap()
        XCTAssertTrue(app.navigationBars["التحصيلات"].waitForExistence(timeout: 5))
    }
}
