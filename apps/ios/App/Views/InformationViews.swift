import SwiftUI

@MainActor enum Company {
    static var phone: String? {
        guard Bundle.main.object(forInfoDictionaryKey: "AlmadinaSupportPhoneConfirmed") as? Bool == true,
              let value = Bundle.main.object(forInfoDictionaryKey: "AlmadinaSupportPhone") as? String,
              value.filter(\.isNumber).count >= 7 else { return nil }
        return value
    }
    static var privacyURL: URL? { publicURL("AlmadinaPrivacyPolicyURL", path: "/privacy") }
    static var deletionURL: URL? { publicURL("AlmadinaAccountDeletionURL", path: "/delete-account") }
    static var supportURL: URL? { publicURL("AlmadinaSupportURL", path: "/support") }
    private static func publicURL(_ key: String, path: String) -> URL? {
        if let value = Bundle.main.object(forInfoDictionaryKey: key) as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let url = URL(string: value), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
            return url
        }
        guard let base = APIClient.baseURL, base.scheme == "https", base.host != nil,
              base.user == nil, base.password == nil,
              var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        parts.path = path; parts.query = nil; parts.fragment = nil
        return parts.url
    }
    static func receiptURL(_ value: String) -> URL? {
        guard let url = URL(string: value), let base = APIClient.baseURL,
              url.scheme == "https", url.host == base.host, url.port == base.port,
              url.user == nil, url.password == nil, url.path == "/delete-account",
              url.fragment?.hasPrefix("receipt=") == true else { return nil }
        return url
    }
}
struct LegalView: View {
    private let terms = [
        ("الحساب وصحة البيانات", "يلزم إدخال بيانات صحيحة وحديثة وحماية كلمة المرور ورموز التحقق وعدم مشاركة الحساب دون إذن."),
        ("الطرود والمحتويات", "يلتزم المرسل بوصف المحتوى وتغليفه بصورة صحيحة وعدم إرسال مواد محظورة أو مخالفة للقانون."),
        ("الرسوم والتحصيل والرواجع", "تظهر الرسوم قبل إنشاء الطرد، وتُسجّل التحصيلات والرواجع داخل الحساب ويؤكدها الموظف أو المسؤول."),
        ("الحذف والاحتفاظ", "يمكن تقديم طلب حذف الحساب من الإعدادات حتى عند وجود طرود نشطة أو تحصيلات مستحقة، دون اشتراط الاتصال بالدعم. تحصل على رقم طلب ورابط متابعة. تُراجع الطلبات خلال 7 أيام تقويمية، ويظهر موعد المراجعة وإجراءات التسوية في حالتها؛ الموعد ليس وعدًا بإكمال الحذف قبل التسوية. تبقى بيانات المعاملات حتى تسوية الالتزامات. عند إكمال الحذف، تُزال بيانات الحساب وطروده وفواتيره ومستلميه وجلساته؛ عند حذف حساب المندوب تبقى طرود أصحابها ويُزال تعيينه منها. تبقى أرقام الملصقات المستخدمة محجوزة دون بيانات المستلمين، ويبقى إيصال حالة محدود بلا بيانات شخصية لمدة 30 يومًا بعد الإكمال. راجع السياسة المنشورة للتفاصيل.")
    ]
    private let privacy = [
        ("السجلات التقنية", "يسجّل الخادم نوع العملية ونتيجتها ومدتها ورقمًا عشوائيًا لتتبع الطلب لتشخيص الأخطاء وحماية الخدمة، دون كلمات المرور أو رموز الدخول أو محتوى الطرود والعناوين. يحتفظ التطبيق محليًا برمز الخطأ ورقم الطلب فقط. راجع سياسة الخصوصية على الموقع لتفاصيل سجلات الاستضافة."),
        ("بيانات الخدمة", "تُرسل بيانات الحساب والمتجر وعناوين المستلمين والطرود والتحصيلات إلى خادم المدينة إكسبرس لتقديم التوصيل والتحصيل وتحديث الحالات وحماية الحساب."),
        ("الحماية على الجهاز", "تُنقل الطلبات عبر HTTPS. تُحفظ الجلسة في Keychain والنسخة المؤقتة مشفّرة على الجهاز. تُمسح النسخة المؤقتة عند تسجيل الخروج."),
        ("البصمة", "Face ID وTouch ID اختياريان. يعالج iOS التحقق محليًا؛ لا يحصل التطبيق على بيانات الوجه أو الإصبع. لا تُحفظ كلمة المرور للدخول بالبصمة إلا عند تفعيلك الميزة، وتكون محمية بقيد البصمة في Keychain."),
        ("الكاميرا", "تُستخدم الكاميرا عند طلب قراءة QR فقط. تُعالج الإطارات محليًا لاستخراج الكود، ولا تُحفظ صور أو فيديو ولا تُرفع للخادم. يُرسل الكود المقروء للتحقق فقط."),
        ("الموقع", "تحديد موقع التسجيل اختياري؛ يمكن كتابة العنوان يدويًا. عند اختيار نقطة على الخريطة تُرسل إحداثياتها مع بيانات التسجيل. لا يجمع التطبيق موقعك في الخلفية."),
        ("الإشعارات والمشاركة", "الإشعارات اختيارية ويمكن ضبطها من إعدادات الجهاز. الطباعة أو المشاركة تُنشئ PDF بطلبك؛ اختر الجهات التي تشاركه معها بعناية."),
        ("حقوقك", "يمكنك الاطلاع على بياناتك وتغيير كلمة المرور وإنهاء جلسات الأجهزة وبدء حذف حسابك من الإعدادات، والتواصل مع الشركة بشأن بياناتك. لا يتضمن هذا التطبيق SDK للإعلانات أو تتبعًا إعلانيًا.")
    ]
    var body: some View {
        Page {
            Text("الشروط والخصوصية والأذونات").font(.title2.bold())
            Text("توضيح خاص بتطبيق iPhone وiPad · 2026-09-09").font(.caption).foregroundStyle(.secondary)
            AppCard { Text("شروط الاستخدام").font(.title3.bold()); ForEach(terms, id: \.0) { entry in Text(entry.0).font(.headline); Text(entry.1); Divider() } }
            AppCard {
                Text("الخصوصية والأذونات").font(.title3.bold())
                ForEach(privacy, id: \.0) { entry in
                    Text(entry.0).font(.headline)
                    Text(entry.1)
                    Divider()
                }
                Text("يجب أن يكون الطرد مطابقًا للوصف المكتوب.").font(.headline)
                    .accessibilityIdentifier("legal.parcel-description-rule")
            }
            AppCard {
                Text("الروابط الرسمية").font(.title3.bold())
                if let url = Company.privacyURL {
                    Link("سياسة الخصوصية على الموقع", destination: url)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityIdentifier("legal.privacy-link")
                }
                if let url = Company.deletionURL {
                    Link("طلب حذف الحساب ومتابعته على الموقع", destination: url)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityIdentifier("legal.deletion-link")
                }
                if let url = Company.supportURL {
                    Link("التواصل مع الدعم", destination: url)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityIdentifier("legal.support-link")
                }
                if let phone = Company.phone, let url = URL(string: "tel:" + phone.filter(\.isNumber)) {
                    Link("التواصل مع الشركة: " + phone, destination: url)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
            }.multilineTextAlignment(.leading)
        }.navigationTitle("الخصوصية والأمان").navigationBarTitleDisplayMode(.inline)
    }
}
struct HelpView: View {
    private let questions = [
        ("ما هي خدمة المدينة إكسبرس؟", "خدمة توصيل للمتاجر والأفراد، مع متابعة الطرود والدفع عند الاستلام وإدارة التحصيلات."),
        ("كيف أبدأ؟", "أنشئ حسابًا باسم المتجر وبياناتك الصحيحة، وأكد بريدك الإلكتروني، ثم أنشئ أول طرد."),
        ("كيف أضيف كود الطرد؟", "أنشئ الطرد أولًا دون كود، ثم افتح تفاصيله واضغط إضافة كود QR. امسح الملصق الذي استلمته من الشركة. لا يمكن استخدام الكود لطردين."),
        ("كيف أستلم المبالغ المحصلة؟", "تُجمع مبالغ الدفع عند الاستلام في حساب متجرك وتُسوّى بحسب الاتفاق مع الشركة."),
        ("كيف أستلم مبالغ التحصيل؟", "أنشئ فاتورة من التحصيلات بعد وصول الطرود. عندما تصبح جاهزة، اعرض رمز التحقق للموظف؛ وبعد قراءة الرمز الصحيح تتغير حالة التحصيل إلى «تم التسليم»."),
        ("هل يمكن إعادة شحن الطرد الراجع؟", "يستطيع المندوب أو الموظف مسح كود الطرد الراجع لإعادته إلى مشحون، ويعيد الخادم التحقق من صلاحياته وحالة الطرد."),
        ("كيف أستعيد طردًا محذوفًا؟", "افتح المحذوفات من الشريط العلوي واستعد الطرد خلال 30 يومًا. لا يعاد استخدام كود طرد قديم لطرد جديد."),
        ("ماذا أفعل إذا انقطع الاتصال أثناء الحفظ؟", "لا تنشئ طردًا ثانيًا. أعد المحاولة من النموذج نفسه. عند إضافة QR يمكنك إعادة حفظ الكود المقروء دون مسحه مرة أخرى."),
        ("كيف أطلب حذف حسابي؟", "افتح الإعدادات ثم حذف الحساب وأرسل طلب الحذف بعد تأكيد هويتك. يُسجل الطلب حتى مع التزامات معلقة، وتستطيع متابعة رقمه وحالته وموعد مراجعته من الشاشة نفسها أو رابط المتابعة. لا يلزم الاتصال بالدعم لتقديمه، ويمكن تقديم الطلب أيضًا من صفحة حذف الحساب على الموقع دون تثبيت التطبيق."),
        ("كيف أستخدم البحث وحالات الطرود؟", "استخدم البحث داخل الرئيسية أو الطرود. اختيار حالة في الرئيسية يعرض نتائجها أسفل الحالات مع إبقاء أحدث الطرود مستقلة.")
    ]
    var body: some View {
        Page {
            AppCard {
                Text("كيف نقدر نساعدك؟").font(.title.bold())
                Text("تصفح الإجابات أو تواصل مع فريق الشركة.")
                if let phone = Company.phone, let url = URL(string: "tel:" + phone.filter(\.isNumber)) { Link(destination: url) { Label("اتصل بالدعم — " + phone, systemImage: "phone").frame(maxWidth: .infinity).padding(.vertical, 10) }.buttonStyle(.borderedProminent) }
                if let url = Company.supportURL { Link(destination: url) { Label("قنوات الدعم الرسمية", systemImage: "globe").frame(maxWidth: .infinity).padding(.vertical, 10) }.buttonStyle(.bordered) }
                if let url = Company.deletionURL { Link("طلب حذف الحساب عبر الموقع", destination: url) }
            }
            ForEach(questions, id: \.0) { entry in AppCard { DisclosureGroup { Text(entry.1).padding(.top, 8) } label: { Text(entry.0).font(.headline) } } }
        }.navigationTitle("مركز المساعدة").navigationBarTitleDisplayMode(.inline)
    }
}
