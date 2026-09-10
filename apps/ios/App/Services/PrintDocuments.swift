import SwiftUI
import UIKit

struct SharedPDF: Identifiable { let id = UUID(); let url: URL }
struct PDFShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url) }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

enum PrintDocuments {
    private static let page = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
    private static func text(_ value: String, rect: CGRect, size: CGFloat = 13, bold: Bool = false, alignment: NSTextAlignment = .right) {
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = alignment; paragraph.baseWritingDirection = alignment == .right ? .rightToLeft : .leftToRight
        (value as NSString).draw(in: rect, withAttributes: [.font: UIFont.systemFont(ofSize: size, weight: bold ? .bold : .regular), .foregroundColor: UIColor.black, .paragraphStyle: paragraph])
    }
    private static func file(_ data: Data, name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name + "-" + UUID().uuidString + ".pdf")
        try data.write(to: url, options: [.atomic, .completeFileProtection]); return url
    }
    static func labels(codes: [String]) throws -> URL {
        guard !codes.isEmpty, codes.allSatisfy(validCode) else { throw DomainError.message("لا توجد أكواد صالحة للطباعة.") }
        let data = UIGraphicsPDFRenderer(bounds: page).pdfData { renderer in
            for (index, code) in codes.enumerated() {
                if index % 24 == 0 { renderer.beginPage() }
                let column = index % 3, row = (index % 24) / 3
                let width: CGFloat = 181, height: CGFloat = 97
                let x = 26 + CGFloat(column) * width, y = 28 + CGFloat(row) * height
                UIColor.lightGray.setStroke(); UIBezierPath(rect: CGRect(x: x, y: y, width: width - 4, height: height - 4)).stroke()
                text("ALMADINA EXPRESS", rect: CGRect(x: x, y: y + 4, width: width - 4, height: 12), size: 7, alignment: .center)
                renderer.cgContext.interpolationQuality = .none
                QRCode.image(code)?.draw(in: CGRect(x: x + (width - 64) / 2, y: y + 15, width: 60, height: 60))
                text(code, rect: CGRect(x: x, y: y + 76, width: width - 4, height: 15), size: 10, bold: true, alignment: .center)
            }
        }
        return try file(data, name: "Almadina-QR-labels")
    }
    static func orders(_ orders: [Record], admin: Bool) throws -> URL {
        guard !orders.isEmpty else { throw DomainError.message("اختر الطرود أولًا.") }
        let data = UIGraphicsPDFRenderer(bounds: page).pdfData { renderer in
            for order in orders {
                renderer.beginPage()
                text("المدينة إكسبرس — تفاصيل الطرد", rect: CGRect(x: 36, y: 35, width: 523, height: 40), size: 22, bold: true)
                text(order.codeLabel, rect: CGRect(x: 36, y: 80, width: 523, height: 28), size: 17, bold: true)
                let rows = ["الحالة: \(order.status?.title ?? order.s("status"))", "المرسل: \(order.s("merchantName")) · \(order.s("merchantStore"))", "المستلم: \(order.s("recipientName"))", "الجوال: \(order.s("recipientPhone"))", "العنوان: \(order.s("governorate")) · \(order.s("city")) · \(order.s("address"))", "نوع الطرد: \(order.s("type"))", "المحتوى: \(order.s("content"))", "سعر الطرد: \(money(order.n("amount")))", "رسوم التوصيل: \(money(order.n("deliveryFee")))", "الوزن: \(order.s("weight")) · الأبعاد: \(order.s("dimensions"))", "المرجع: \(order.s("reference"))", "تعليمات: \(order.s("notes"))"] + (admin ? ["ملاحظة خاصة: \(order.s("privateNotes"))"] : [])
                var y: CGFloat = 123
                for row in rows {
                    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .right
                    let height = max(26, (row as NSString).boundingRect(with: CGSize(width: 515, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: UIFont.systemFont(ofSize: 13), .paragraphStyle: paragraph], context: nil).height + 12)
                    if y + height > 775 { renderer.beginPage(); y = 40 }
                    text(row, rect: CGRect(x: 40, y: y, width: 515, height: height)); y += height
                }
                if let qr = QRCode.image(order.s("trackingNumber")) {
                    if y + 135 > 795 { renderer.beginPage(); y = 40 }
                    renderer.cgContext.interpolationQuality = .none; qr.draw(in: CGRect(x: 425, y: y, width: 125, height: 125))
                }
            }
        }
        return try file(data, name: "Almadina-parcels")
    }
    static func invoice(_ invoice: Record) throws -> URL {
        let data = UIGraphicsPDFRenderer(bounds: page).pdfData { renderer in
            renderer.beginPage()
            let rows = ["المدينة إكسبرس", "فاتورة تحصيل \(invoice.s("invoiceNumber"))", invoice.s("merchantName"), invoiceTitle(invoice.s("status")), "إجمالي الطرود: \(money(invoice.n("grossAmount")))", "رسوم التوصيل: \(money(invoice.n("deliveryFees")))", "رسوم الرواجع: \(money(invoice.n("returnFees")))", "\(dueTitle(invoice.n("netAmount"))): \(money(invoice.n("netAmount")))", "واصل: \(Int(invoice.n("deliveredCount"))) · راجع: \(Int(invoice.n("returnedCount")))", invoice.s("createdAt")]
            for (index, row) in rows.enumerated() { text(row, rect: CGRect(x: 40, y: 40 + CGFloat(index) * 43, width: 515, height: 38), size: index < 2 ? 22 : 16, bold: index < 2 || index == 7) }
            text("رمز التحقق يُعرض داخل التطبيق فقط، ولا يُضمّن في نسخة الفاتورة المشتركة.", rect: CGRect(x: 40, y: 540, width: 515, height: 60), size: 12)
        }
        return try file(data, name: "Almadina-invoice")
    }
}
