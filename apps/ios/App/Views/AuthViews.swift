import SwiftUI

struct LoginView: View {
    @EnvironmentObject var store: AppStore
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        NavigationStack {
            Page {
                BrandView()
                AppCard {
                    Text("تسجيل الدخول").font(.title2.bold())
                    Input(title: "البريد الإلكتروني", value: $email, keyboard: .emailAddress, contentType: .username)
                    Input(title: "كلمة المرور", value: $password, secure: true)
                    AppButton("تسجيل الدخول", icon: "arrow.right.circle") { Task { await store.login(email: email, password: password); if store.user != nil { password = "" } } }.disabled(store.busy || email.isEmpty || password.isEmpty).accessibilityIdentifier("login.submit")
                    if store.biometricEnabled {
                        Button { Task { await store.biometricLogin() } } label: { Label("الدخول ببصمة الوجه أو الإصبع", systemImage: "faceid").frame(maxWidth: .infinity).padding(.vertical, 10) }.buttonStyle(.bordered).disabled(store.busy)
                        if let name = store.accounts.first(where: { $0.id == store.biometricUserID })?.name { Text("حساب البصمة: " + name).font(.caption).foregroundStyle(.secondary) }
                    }
                    if !store.accounts.isEmpty {
                        DisclosureGroup("الحسابات المتاحة") {
                            ForEach(store.accounts) { account in
                                HStack {
                                    Button { email = account.email; password = "" } label: { VStack(alignment: .leading) { Text(account.name).fontWeight(.semibold); Text(account.store).font(.caption).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading) }
                                    Button { store.forgetAccount(account) } label: { Image(systemName: "xmark.circle") }.accessibilityLabel("إزالة \(account.name) من الحسابات المتاحة")
                                }.padding(.vertical, 8)
                            }
                        }
                    }
                    NavigationLink("نسيت كلمة المرور؟") { PasswordResetView() }
                    Divider()
                    NavigationLink { RegistrationView() } label: { Label("إنشاء حساب جديد", systemImage: "person.badge.plus").frame(maxWidth: .infinity).padding(.vertical, 10) }.buttonStyle(.bordered).accessibilityIdentifier("login.register")
                }
                PublicTrackingView(embedded: true)
                HStack {
                    NavigationLink("الشروط والخصوصية") { LegalView() }
                    Spacer()
                    NavigationLink("مركز المساعدة") { HelpView() }
                }.font(.footnote)
                if let url = Company.deletionURL { Link("طلب حذف الحساب عبر الموقع", destination: url).font(.footnote) }
                Picker("المظهر", selection: Binding(get: { store.theme }, set: store.setTheme)) { Text("تلقائي").tag("system"); Text("فاتح").tag("light"); Text("داكن").tag("dark") }.pickerStyle(.segmented)
            }.navigationBarTitleDisplayMode(.inline)
        }.safeAreaInset(edge: .top, spacing: 0) { MessageBanner() }
    }
}

struct RegistrationView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var name = ""
    @State private var phone = ""
    @State private var shop = ""
    @State private var email = ""
    @State private var city = ""
    @State private var area = ""
    @State private var address = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var code = ""
    @State private var accepted = false
    @State private var mapOpen = false
    @State private var latitude: Double?
    @State private var longitude: Double?
    private var fields: JObject {
        ["name": .string(name), "phone": .string(normalizedDigits(phone)), "store": .string(shop), "email": .string(email.lowercased()), "governorate": .string(city), "city": .string(area), "address": .string(address), "password": .string(password), "latitude": .number(latitude ?? 0), "longitude": .number(longitude ?? 0), "locationMethod": .string(latitude == nil ? "manual" : "map"), "acceptedTerms": .bool(accepted)]
    }
    var body: some View {
        Page {
            ProgressView(value: Double(min(step + 1, 4)), total: 4).tint(.brand)
            Text(step == 4 ? "تأكيد البريد الإلكتروني" : "الخطوة \(step + 1) من 4").font(.headline)
            AppCard {
                if step == 0 {
                    Input(title: "الاسم الكامل", value: $name)
                    Input(title: "رقم الجوال", value: $phone, keyboard: .phonePad)
                    Input(title: "اسم المتجر", value: $shop)
                    Input(title: "البريد الإلكتروني", value: $email, keyboard: .emailAddress)
                } else if step == 1 {
                    Input(title: "المدينة", value: $city)
                    Input(title: "المنطقة", value: $area)
                    Input(title: "الشارع / وصف العنوان", value: $address, multiline: true)
                    Button { mapOpen = true } label: { Label("تحديد الموقع على الخريطة (اختياري)", systemImage: "map") }
                    if let latitude, let longitude {
                        Text(String(format: "%.5f, %.5f", latitude, longitude)).font(.caption)
                        Button("إزالة الموقع واستخدام العنوان المكتوب") { self.latitude = nil; self.longitude = nil }
                    }
                } else if step == 2 {
                    Input(title: "كلمة المرور", value: $password, secure: true, contentType: .newPassword)
                    Input(title: "تأكيد كلمة المرور", value: $confirmation, secure: true, contentType: .newPassword)
                    Text("8 أحرف على الأقل، تتضمن حرفًا ورقمًا ورمزًا.").font(.footnote).foregroundStyle(.secondary)
                } else if step == 3 {
                    DetailLine(title: "الاسم والمتجر", value: name + " · " + shop)
                    DetailLine(title: "البريد الإلكتروني", value: email)
                    DetailLine(title: "العنوان", value: city + " · " + area + " · " + address)
                    NavigationLink("قراءة الشروط وسياسة الخصوصية والأذونات") { LegalView() }
                    Toggle("قرأت وأوافق على شروط الاستخدام وسياسة الخصوصية", isOn: $accepted).tint(.brand)
                } else {
                    Text("أدخل رمز التحقق المرسل إلى بريدك الإلكتروني. لا تشارك الرمز مع الآخرين.")
                    Input(title: "رمز التحقق", value: $code, keyboard: .numberPad, contentType: .oneTimeCode)
                    AppButton("تأكيد وإنشاء الحساب", icon: "checkmark.shield") { Task { if await store.verifyRegistration(code) { password = ""; confirmation = ""; dismiss() } } }.disabled(store.busy || code.count != 6)
                    Button("إعادة إرسال الرمز") { Task { _ = await store.register(fields) } }.disabled(store.busy)
                }
                if step < 4 { AppButton(step == 3 ? "إرسال رمز التحقق" : "التالي", icon: "arrow.forward") { next() }.disabled(store.busy || (step == 3 && !accepted)) }
                if step > 0 && step < 4 { Button("الخطوة السابقة") { step -= 1 }.disabled(store.busy) }
            }
        }.navigationTitle("إنشاء حساب").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $mapOpen) { LocationPicker { point in latitude = point.latitude; longitude = point.longitude } }
    }
    private func next() {
        switch step {
        case 0:
            guard name.count >= 2, !shop.isEmpty, validPhone(phone), validEmail(email) else { store.report("أكمل الاسم والمتجر وبريدًا صحيحًا وجوالًا من 10 أرقام يبدأ بـ 05."); return }
            step += 1
        case 1:
            guard !city.isEmpty, !area.isEmpty, !address.isEmpty else { store.report("أكمل المدينة والمنطقة والشارع / وصف العنوان."); return }; step += 1
        case 2:
            guard validPassword(password), password == confirmation else { store.report("راجع شروط كلمة المرور وتأكد من تطابق التأكيد."); return }; step += 1
        case 3: Task { if await store.register(fields) { step = 4 } }
        default: break
        }
    }
}

struct PasswordResetView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var confirmation = ""
    var body: some View {
        Page {
            AppCard {
                Text("استعادة الحساب بالبريد الإلكتروني").font(.headline)
                if step == 0 { Input(title: "البريد المسجّل في الحساب", value: $email, keyboard: .emailAddress) }
                if step == 1 { Input(title: "رمز التحقق", value: $code, keyboard: .numberPad, contentType: .oneTimeCode) }
                if step == 2 {
                    Input(title: "كلمة المرور الجديدة", value: $password, secure: true, contentType: .newPassword)
                    Input(title: "تأكيد كلمة المرور", value: $confirmation, secure: true, contentType: .newPassword)
                }
                AppButton(step == 0 ? "إرسال الرمز" : step == 1 ? "تأكيد الرمز" : "حفظ كلمة المرور") { submit() }.disabled(store.busy)
            }
        }.navigationTitle("نسيت كلمة المرور؟").navigationBarTitleDisplayMode(.inline)
    }
    private func submit() {
        Task {
            let ok = await store.perform {
                if step == 0 {
                    guard validEmail(email) else { throw DomainError.message("أدخل البريد الإلكتروني المسجّل.") }
                    _ = try await store.api.request("password-reset/request", method: "POST", body: ["identifier": .string(email.lowercased())])
                } else if step == 1 {
                    _ = try await store.api.request("password-reset/verify", method: "POST", body: ["code": .string(normalizedDigits(code))])
                } else {
                    guard validPassword(password), password == confirmation else { throw DomainError.message("راجع قوة كلمة المرور وتطابق التأكيد.") }
                    _ = try await store.api.request("password-reset/complete", method: "POST", body: ["newPassword": .string(password), "confirmPassword": .string(confirmation)])
                    store.disableBiometrics()
                }
            }
            if ok { if step < 2 { step += 1 } else { password = ""; confirmation = ""; store.report("تم تغيير كلمة المرور. سجّل الدخول بكلمتك الجديدة."); dismiss() } }
        }
    }
}

struct PublicTrackingView: View {
    @EnvironmentObject var store: AppStore
    var embedded = false
    @State private var code = ""
    @State private var scanner = false
    @State private var order: Record?
    var body: some View {
        AppCard {
            Text("تتبع طردك").font(.title2.bold())
            Text("أدخل رقم التتبع أو اقرأ QR دون تسجيل الدخول.").font(.subheadline).foregroundStyle(.secondary)
            Input(title: "ALX-000000", value: $code)
            AppButton("تتبع الطرد", icon: "magnifyingglass") { lookup() }.disabled(store.busy || code.isEmpty)
            Button { scanner = true } label: { Label("قراءة QR بالكاميرا", systemImage: "qrcode.viewfinder") }
            if let order { Divider(); Text(order.codeLabel).font(.headline); StatusBadge(status: order.status); Timeline(order: order) }
        }.sheet(isPresented: $scanner) { ScannerSheet(title: "تتبع الطرد") { code = normalizedCode($0); lookup() } }
    }
    private func lookup() {
        Task {
            await store.perform {
                guard validCode(code) else { throw DomainError.message("أدخل كود طرد صحيحًا.") }
                var parts = URLComponents(); parts.queryItems = [URLQueryItem(name: "tracking", value: normalizedCode(code))]
                let payload = try await store.api.request("track?" + (parts.percentEncodedQuery ?? ""))
                guard let value = payload["order"], case .object(let raw) = value else { throw DomainError.message("استجابة التتبع غير مكتملة.") }
                order = Record(raw)
            }
        }
    }
}
