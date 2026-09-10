import SwiftUI
import UIKit

struct RowDeleteActions: ViewModifier {
    @Environment(\.layoutDirection) private var direction
    @State private var confirming = false
    let title: String
    let message: String
    let enabled: Bool
    var buttonTitle = "حذف"
    let action: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content
                // A physical left swipe exposes the right edge, including Arabic RTL.
                .swipeActions(edge: direction == .rightToLeft ? .leading : .trailing, allowsFullSwipe: false) {
                    Button { confirming = true } label: { Label(buttonTitle, systemImage: "trash") }.tint(.red)
                }
                .contextMenu { Button(title, role: .destructive) { confirming = true } }
                .accessibilityAction(named: Text(title)) { confirming = true }
                .confirmationDialog(title, isPresented: $confirming, titleVisibility: .visible) {
                    Button(buttonTitle, role: .destructive, action: action)
                    Button("إلغاء", role: .cancel) {}
                } message: { Text(message) }
        } else { content }
    }
}

struct ParcelLink: View {
    @EnvironmentObject var store: AppStore
    let order: Record
    var body: some View {
        NavigationLink(value: Route.order(order.id)) { OrderRow(order: order) }
            .modifier(RowDeleteActions(title: "نقل الطرد إلى المحذوفات؟", message: "يمكن استعادته خلال 30 يومًا.", enabled: !store.busy && !store.offline && !order.b("deleted") && store.snapshot?.canTrash(order) == true) {
                Task { _ = await store.trashOrder(order) }
            })
    }
}

extension Color {
    static let brand = Color("AccentColor")
    static let onBrand = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? .black : .white })
}
extension ParcelStatus {
    var color: Color {
        switch self { case .draft: return .secondary; case .ready: return Color(red: 0.64, green: 0.35, blue: 0.05); case .shipped: return .purple; case .processing: return .teal; case .delivered: return .brand; case .stuck: return .pink; case .returned: return .red; case .deferred: return .indigo }
    }
}
extension String {
    @MainActor
    var dateDisplay: String {
        if let saved = DisplayDates.cache.object(forKey: self as NSString) { return saved as String }
        guard let date = parseDate(self) else { return self }
        let result = DisplayDates.formatter.string(from: date)
        DisplayDates.cache.setObject(result as NSString, forKey: self as NSString)
        return result
    }
}
@MainActor private enum DisplayDates {
    static let formatter: DateFormatter = {
        let value = DateFormatter(); value.locale = Locale(identifier: "ar_PS"); value.dateStyle = .medium; value.timeStyle = .short
        return value
    }()
    static let cache: NSCache<NSString, NSString> = { let value = NSCache<NSString, NSString>(); value.countLimit = 512; return value }()
}
struct BrandView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image("BrandMark").renderingMode(.original).resizable().scaledToFit()
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .accessibilityLabel("شعار المدينة إكسبرس").accessibilityIdentifier("brand.mark")
            Text("المدينة إكسبرس").font(.largeTitle.bold())
            Text("طرودك وتحصيلاتك، من مكان واحد").foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 16)
    }
}
struct AppCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View { VStack(alignment: .leading, spacing: 14) { content }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous)) }
}
struct Page<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View { ScrollView { VStack(alignment: .leading, spacing: 18) { content }.padding(16).frame(maxWidth: 960).frame(maxWidth: .infinity) }.background(Color(uiColor: .systemGroupedBackground)).scrollDismissesKeyboard(.interactively) }
}
struct AppButton: View {
    var title: String
    var icon: String = ""
    var action: () -> Void
    init(_ title: String, icon: String = "", action: @escaping () -> Void) { self.title = title; self.icon = icon; self.action = action }
    var body: some View {
        Button(action: action) { HStack { if !icon.isEmpty { Image(systemName: icon) }; Text(title).fontWeight(.semibold).multilineTextAlignment(.center) }.foregroundStyle(Color.onBrand).frame(maxWidth: .infinity).padding(.vertical, 8) }
            .buttonStyle(.borderedProminent).tint(.brand).controlSize(.large)
    }
}
struct NewOrderFloatingButton: ViewModifier {
    @EnvironmentObject var store: AppStore
    var enabled = true
    @ViewBuilder func body(content: Content) -> some View {
        if enabled && store.role != .courier {
            content
                .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: 76).allowsHitTesting(false) }
                // Trailing is the physical left in this app's Arabic layout.
                // This inset stays above the native tab bar and the keyboard.
                .overlay(alignment: .bottomTrailing) {
                    NavigationLink(value: Route.newOrder) {
                        Image(systemName: "plus").font(.system(size: 30, weight: .medium))
                            .foregroundStyle(Color(red: 0.02, green: 0.22, blue: 0.23))
                            .frame(width: 58, height: 58)
                            .background(Color(red: 8.0 / 255, green: 205.0 / 255, blue: 211.0 / 255), in: Circle())
                            .shadow(color: .black.opacity(0.16), radius: 6, y: 3)
                    }.buttonStyle(.plain).accessibilityLabel("إنشاء طرد جديد")
                        .padding(.horizontal, 20).padding(.bottom, 12)
                }
        } else { content }
    }
}

struct Input: View {
    let title: String
    @Binding var value: String
    var keyboard: UIKeyboardType = .default
    var secure = false
    var multiline = false
    var contentType: UITextContentType? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Group {
                if multiline && !secure {
                    NativeMultilineInput(title: title, text: $value)
                        .overlay(alignment: .topLeading) {
                            if value.isEmpty { Text(title).foregroundStyle(.tertiary).allowsHitTesting(false).accessibilityHidden(true) }
                        }
                }
                else { NativeTextInput(title: title, text: $value, keyboard: keyboard, secure: secure, contentType: contentType) }
            }.padding(12).background(Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

/// Keep UIKit's editing buffer visible while publishing every edit to SwiftUI.
/// In particular, never format a decimal or replace unchanged text on a redraw:
/// a partial value such as "100." and the insertion point must survive typing.
private struct NativeTextInput: UIViewRepresentable {
    let title: String
    @Binding var text: String
    let keyboard: UIKeyboardType
    let secure: Bool
    let contentType: UITextContentType?
    @Environment(\.isEnabled) private var isEnabled
    func makeCoordinator() -> LiveInputCoordinator { LiveInputCoordinator(text: $text) }
    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.isSecureTextEntry = secure
        field.keyboardType = keyboard
        field.textContentType = contentType ?? (secure ? .password : keyboard == .phonePad ? .telephoneNumber : keyboard == .emailAddress ? .emailAddress : nil)
        let literal = secure || keyboard != .default
        field.autocorrectionType = literal ? .no : .default
        field.spellCheckingType = literal ? .no : .default
        field.autocapitalizationType = literal ? .none : .sentences
        field.smartQuotesType = literal ? .no : .default
        field.smartDashesType = literal ? .no : .default
        field.semanticContentAttribute = literal ? .forceLeftToRight : .forceRightToLeft
        field.textAlignment = literal ? .left : .natural
        field.textColor = .label
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.returnKeyType = .done
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.addTarget(context.coordinator, action: #selector(LiveInputCoordinator.changed(_:)), for: .editingChanged)
        return field
    }
    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.text = $text
        field.placeholder = title; field.accessibilityLabel = title
        field.isEnabled = isEnabled
        // SwiftUI may update other fields after an edit, a fee calculation or a
        // refresh. Do not disturb the focused field or an IME composition.
        guard field.text != text, field.markedTextRange == nil else { return }
        let offsets = field.selectedTextRange.map { selection in
            (field.offset(from: field.beginningOfDocument, to: selection.start), field.offset(from: field.beginningOfDocument, to: selection.end))
        }
        field.text = text
        if field.isFirstResponder, let (start, end) = offsets,
           let a = field.position(from: field.beginningOfDocument, offset: min(start, text.utf16.count)),
           let b = field.position(from: field.beginningOfDocument, offset: min(end, text.utf16.count)) {
            field.selectedTextRange = field.textRange(from: a, to: b)
        }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? max(1, uiView.intrinsicContentSize.width), height: max(24, uiView.intrinsicContentSize.height))
    }
    static func dismantleUIView(_ field: UITextField, coordinator: LiveInputCoordinator) {
        field.removeTarget(coordinator, action: #selector(LiveInputCoordinator.changed(_:)), for: .editingChanged)
        field.delegate = nil
    }
}

private struct NativeMultilineInput: UIViewRepresentable {
    let title: String
    @Binding var text: String
    @Environment(\.isEnabled) private var isEnabled
    func makeCoordinator() -> LiveInputCoordinator { LiveInputCoordinator(text: $text) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textColor = .label
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textAlignment = .natural
        view.semanticContentAttribute = .forceRightToLeft
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.keyboardDismissMode = .interactive
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.text = $text
        view.accessibilityLabel = title
        view.isEditable = isEnabled
        guard view.text != text, view.markedTextRange == nil else { return }
        let selection = view.selectedRange
        view.text = text
        if view.isFirstResponder {
            let location = min(selection.location, text.utf16.count)
            view.selectedRange = NSRange(location: location, length: min(selection.length, text.utf16.count - location))
        }
        view.invalidateIntrinsicContentSize()
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let line = uiView.font?.lineHeight ?? 20
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let maximum = ceil(line * 8)
        let scrolls = fitted.height > maximum
        if uiView.isScrollEnabled != scrolls { uiView.isScrollEnabled = scrolls }
        return CGSize(width: width, height: min(maximum, max(ceil(line * 3), ceil(fitted.height))))
    }
    static func dismantleUIView(_ view: UITextView, coordinator: LiveInputCoordinator) { view.delegate = nil }
}

@MainActor private final class LiveInputCoordinator: NSObject, UITextFieldDelegate, UITextViewDelegate {
    var text: Binding<String>
    init(text: Binding<String>) { self.text = text }
    private func publish(_ value: String) {
        if text.wrappedValue != value { text.wrappedValue = value }
    }
    @objc func changed(_ sender: UITextField) { publish(sender.text ?? "") }
    func textFieldDidEndEditing(_ textField: UITextField) { publish(textField.text ?? "") }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }
    func textViewDidChange(_ textView: UITextView) { publish(textView.text ?? ""); textView.invalidateIntrinsicContentSize() }
    func textViewDidEndEditing(_ textView: UITextView) { publish(textView.text ?? "") }
}
struct EmptyViewState: View {
    let title: String
    var description = "ستظهر البيانات هنا عند توفرها."
    var icon = "shippingbox"
    var body: some View {
        VStack(spacing: 12) { Image(systemName: icon).font(.largeTitle).foregroundStyle(Color.brand); Text(title).font(.title3.bold()); Text(description).foregroundStyle(.secondary).multilineTextAlignment(.center) }.frame(maxWidth: .infinity).padding(28)
    }
}
struct StatusBadge: View {
    let status: ParcelStatus?
    var body: some View { Label(status?.title ?? "غير معروف", systemImage: status?.symbol ?? "questionmark.circle").font(.caption.weight(.semibold)).foregroundStyle(status?.color ?? .secondary).padding(8).background((status?.color ?? .secondary).opacity(0.12), in: Capsule()).fixedSize(horizontal: false, vertical: true) }
}
struct OrderRow: View {
    let order: Record
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack { Text(order.codeLabel).font(.headline); Spacer(); StatusBadge(status: order.status) }
                VStack(alignment: .leading) { Text(order.codeLabel).font(.headline); StatusBadge(status: order.status) }
            }
            Text(order.s("recipientName")).fontWeight(.medium)
            Text(order.s("city") + " · " + order.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
            Text(money(order.n("amount"))).font(.headline).foregroundStyle(Color.brand)
        }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}
struct DetailLine: View {
    let title: String, value: String
    var body: some View { VStack(alignment: .leading, spacing: 5) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value.isEmpty ? "—" : value).textSelection(.enabled) }.frame(maxWidth: .infinity, alignment: .leading) }
}
struct MessageBanner: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        if let message = store.message {
            HStack(alignment: .top) { Text(message.text).font(.subheadline); Spacer(); Button { store.message = nil } label: { Image(systemName: "xmark.circle.fill").font(.title3) }.accessibilityLabel("إغلاق الرسالة") }
                .padding().frame(maxWidth: .infinity).background(.regularMaterial).accessibilityElement(children: .contain)
        }
        if store.offline, store.snapshot != nil { Label("غير متصل — البيانات المحفوظة للقراءة فقط", systemImage: "wifi.slash").font(.caption).padding(8).frame(maxWidth: .infinity).background(Color.orange.opacity(0.12)) }
        if store.busy { ProgressView("جارٍ تنفيذ الطلب…").font(.caption).frame(maxWidth: .infinity).padding(6).background(.regularMaterial) }
    }
}
struct Timeline: View {
    let order: Record
    var body: some View {
        ForEach(order.events) { event in
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: event.s("kind") == "note" ? "text.bubble" : event.status?.symbol ?? "circle").font(.title3).foregroundStyle(Color.brand).frame(width: 28)
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.s("title")).font(.headline)
                    if !event.s("note").isEmpty { Text(event.s("note")) }
                    Text(event.s("location") + " · " + event.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
                    if !event.s("actor").isEmpty { Text(event.s("actor")).font(.caption).foregroundStyle(.secondary) }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5)
        }
    }
}
