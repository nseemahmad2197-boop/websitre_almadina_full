import XCTest

/// Local UI fixtures never contact the service. Server-connected end-to-end
/// tests still require dedicated staging accounts.
final class AlmadinaExpressUITests: XCTestCase {
    private var app: XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication()
        app.launchArguments = ["--ui-test-no-network", "-AppleLanguages", "(ar)", "-AppleLocale", "ar_PS"]
        app.launch()
    }
    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "Failure-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
            if app.state == .runningForeground {
                let hierarchy = XCTAttachment(string: app.debugDescription)
                hierarchy.name = "Failure-accessibility-tree"; hierarchy.lifetime = .keepAlways; add(hierarchy)
            }
        }
        app.terminate(); app = nil
        XCUIDevice.shared.orientation = .portrait
    }
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
        // Swipe the List cell, not an arbitrary text descendant inheriting
        // the NavigationLink identifier. Both table and collection-backed
        // SwiftUI Lists expose their rows through cells.
        let identifier = "invoice.row." + id
        let cell = app.cells.matching(identifier: identifier).firstMatch
        if cell.exists { return cell }
        return app.cells.containing(.any, identifier: identifier).firstMatch
    }
    func testPaidInvoiceCardsRevealDeleteOnPhysicalLeftSwipeAndCancelKeepsThem() throws {
        openInvoiceFixture()
        for id in ["ui-paid", "ui-paid-company"] {
            let row = invoiceRow(id)
            reveal(row)
            // Also test a long swipe: deletion requires tapping and confirmation.
            row.swipeLeft(velocity: .fast)
            let deletion = app.buttons["invoice.delete." + id + ".reveal"]
            XCTAssertTrue(deletion.waitForExistence(timeout: 3))
            XCTAssertTrue(deletion.isHittable)
            XCTAssertTrue(row.exists)
            deletion.tap()
            XCTAssertTrue(app.staticTexts["حذف الفاتورة من قائمتك؟"].waitForExistence(timeout: 3))
            app.buttons["invoice.delete." + id + ".cancel"].tap()
            XCTAssertTrue(row.exists)
            XCTAssertFalse(app.staticTexts["الاتصال معطّل في اختبارات الواجهة."].exists)
        }
    }
    func testOutstandingInvoiceCardDoesNotExposeDeleteOnLeftSwipe() throws {
        openInvoiceFixture()
        let row = invoiceRow("ui-due")
        reveal(row)
        row.swipeLeft()
        XCTAssertFalse(app.buttons["حذف الفاتورة"].exists)
        XCTAssertTrue(row.exists)
        row.tap()
        XCTAssertTrue(app.navigationBars["تفاصيل التحصيل"].waitForExistence(timeout: 5))
    }
    private func clearOrderForm() throws {
        let open = app.buttons["order.clear.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        open.tap()
        let clear = app.buttons["order.clear.confirm"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5))
        clear.tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: clear)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed)
    }
    private func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<16 {
            let viewport = scrollViewport()
            guard viewport.height > 40 else { break }
            let frame = element.exists ? element.frame : .zero
            if element.isHittable && frame.minY >= viewport.minY && frame.maxY <= viewport.maxY { return }
            let above = !frame.isEmpty && frame.midY < viewport.minY
            // Stay inside the scroll view, outside the keyboard, tab bar and
            // multiline text views. App-wide swipes can operate the keyboard.
            let startY = viewport.minY + viewport.height * (above ? 0.25 : 0.75)
            let endY = viewport.minY + viewport.height * (above ? 0.75 : 0.25)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let x = viewport.maxX - 12 - app.frame.minX
            let start = origin.withOffset(CGVector(dx: x, dy: startY - app.frame.minY))
            let end = origin.withOffset(CGVector(dx: x, dy: endY - app.frame.minY))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTFail("Could not reveal \(element.identifier): \(element.debugDescription)", file: file, line: line)
    }
    private func scrollViewport() -> CGRect {
        let scrolls = app.scrollViews.allElementsBoundByIndex + app.collectionViews.allElementsBoundByIndex + app.tables.allElementsBoundByIndex
        let frames = scrolls.filter { $0.isHittable }.map { $0.frame.intersection(app.frame) }.filter { !$0.isNull && !$0.isEmpty }
        // On iPad use the detail pane's scroll region; the sidebar's large
        // title must not reduce the usable area of a different column.
        var viewport = frames.max { $0.width * $0.height < $1.width * $1.height } ?? app.frame
        for bar in app.navigationBars.allElementsBoundByIndex where bar.isHittable && bar.frame.intersection(viewport).width > 0 && bar.frame.minY <= viewport.minY {
            let top = max(viewport.minY, bar.frame.maxY)
            viewport = CGRect(x: viewport.minX, y: top, width: viewport.width, height: max(0, viewport.maxY - top))
        }
        let bottomControls = app.tabBars.allElementsBoundByIndex + app.keyboards.allElementsBoundByIndex
        for control in bottomControls where control.exists && control.frame.intersects(viewport) {
            viewport.size.height = max(0, min(viewport.maxY, control.frame.minY) - viewport.minY)
        }
        guard viewport.width > 32, viewport.height > 32 else { return .zero }
        return viewport.insetBy(dx: 4, dy: 8)
    }
    private func goBack(from title: String, to previousTitle: String) {
        let bar = app.navigationBars[title]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        // Index 0 can be a menu/toolbar button in RTL. Match the native back
        // button by its destination label instead of its position in the tree.
        let labels = [previousTitle, "رجوع", "عودة", "Back"]
        let back = bar.buttons.matching(NSPredicate(format: "label IN %@ OR identifier IN %@", labels, labels)).firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(app.navigationBars[previousTitle].waitForExistence(timeout: 5))
    }
    private func assertValue(_ value: String, of element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let matches = NSPredicate(format: "value == %@", value)
        let ready = XCTNSPredicateExpectation(predicate: matches, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed,
                       "Expected \(value); actual \(String(describing: element.value))", file: file, line: line)
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
        // Exercise the app's editing buffer without relying on a system key's
        // localized accessibility label (it need not equal its punctuation).
        let separator = "."
        price.typeText(separator)
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
        XCTAssertTrue(app.staticTexts["نتائج البحث"].waitForExistence(timeout: 5))
        search.typeText(XCUIKeyboardKey.delete.rawValue)
        assertValue("AL", of: search)
    }
    func testSupportOpensHelpFromDeleteAccountAndReturnsToForm() throws {
        launchMerchant()
        app.buttons["القائمة الجانبية"].tap()
        app.buttons["navigation.settings"].tap()
        let deletion = app.buttons["حذف الحساب"]
        reveal(deletion)
        deletion.tap()
        let support = app.buttons["account.support"]
        XCTAssertTrue(support.waitForExistence(timeout: 5))
        reveal(support)
        support.tap()
        XCTAssertTrue(app.navigationBars["مركز المساعدة"].waitForExistence(timeout: 5))
        goBack(from: "مركز المساعدة", to: "حذف الحساب")
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
