import Foundation

public enum ParcelCSV {
    public static func parse(_ source: String) throws -> [[String]] {
        guard source.utf8.count <= 5_000_000 else { throw DomainError.message("ملف CSV أكبر من 5 MB.") }
        let characters = Array(source.replacingOccurrences(of: "\u{FEFF}", with: ""))
        var rows: [[String]] = [], row: [String] = [], field = "", quoted = false, closedQuote = false, index = 0
        func finishField() { row.append(field); field = ""; closedQuote = false }
        while index < characters.count {
            let character = characters[index]
            if quoted {
                if character == "\"" {
                    if index + 1 < characters.count && characters[index + 1] == "\"" { field.append("\""); index += 1 }
                    else { quoted = false; closedQuote = true }
                } else { field.append(character) }
            } else if character == "," { finishField() }
            else if character == "\r\n" || character == "\n" || character == "\r" {
                finishField(); if row.contains(where: { !$0.isEmpty }) { rows.append(row) }; row = []
            } else if character == "\"" && field.isEmpty && !closedQuote { quoted = true }
            else if closedQuote { if !character.isWhitespace { throw DomainError.message("تنسيق CSV غير صالح بعد علامة الاقتباس.") } }
            else if character == "\"" { throw DomainError.message("علامة اقتباس غير متوقعة في CSV.") }
            else { field.append(character) }
            index += 1
        }
        guard !quoted else { throw DomainError.message("يوجد حقل اقتباس غير مكتمل في CSV.") }
        if !field.isEmpty || !row.isEmpty || closedQuote { finishField(); rows.append(row) }
        return rows
    }
    public static func drafts(_ source: String) throws -> [OrderDraft] {
        let rows = try parse(source)
        guard let header = rows.first, rows.count > 1, rows.count <= 501 else { throw DomainError.message("يجب أن يتضمن الملف رأس الأعمدة ومن 1 إلى 500 طرد.") }
        let aliases: [String: String] = ["اسم المستلم": "recipientName", "رقم الجوال": "recipientPhone", "الجوال": "recipientPhone", "المدينة": "city", "العنوان": "address", "سعر الطرد": "amount", "النطاق": "deliveryZone", "المحتوى": "content", "الوزن": "weight", "الطول": "lengthCm", "العرض": "widthCm", "الارتفاع": "heightCm", "نوع الطرد": "type"]
        let names = header.map { value -> String in let clean = value.trimmingCharacters(in: .whitespaces); return aliases[clean] ?? clean }
        guard Set(names).count == names.count else { throw DomainError.message("يوجد عمود مكرر في الملف.") }
        for key in ["recipientName", "recipientPhone", "city", "address", "amount"] where !names.contains(key) { throw DomainError.message("العمود المطلوب مفقود: " + key) }
        return try rows.dropFirst().enumerated().map { entry in
            let (rowIndex, values) = entry
            guard values.count == names.count else { throw DomainError.message("عدد الأعمدة غير صحيح في السطر \(rowIndex + 2).") }
            let map = Dictionary(uniqueKeysWithValues: zip(names, values))
            var draft = OrderDraft()
            draft.recipientName = map["recipientName"] ?? ""; draft.recipientPhone = map["recipientPhone"] ?? ""
            draft.city = map["city"] ?? ""; draft.address = map["address"] ?? ""; draft.amount = map["amount"] ?? ""
            draft.content = map["content"] ?? ""; draft.zone = Zone.from(map["deliveryZone"] ?? map["governorate"] ?? "")
            draft.governorate = map["governorate"] ?? ""
            draft.type = map["type"].flatMap { OrderDraft.types.contains($0) ? $0 : nil } ?? "طرد عادي"
            draft.weight = map["weight"].flatMap { Pricing.weights.contains($0) ? $0 : nil } ?? Pricing.weights[0]
            draft.length = map["lengthCm"] ?? ""; draft.width = map["widthCm"] ?? ""; draft.height = map["heightCm"] ?? ""
            draft.instructions = map["notes"] ?? ""; draft.privateNote = map["privateNotes"] ?? ""; draft.reference = map["reference"] ?? ""
            do { try draft.validate() } catch { throw DomainError.message("السطر \(rowIndex + 2): " + error.localizedDescription) }
            return draft
        }
    }
    public static func template() -> String { "\u{FEFF}recipientName,recipientPhone,governorate,city,address,amount,deliveryZone,content,weight,lengthCm,widthCm,heightCm,type,notes,privateNotes,reference\r\n" }
    public static func export(_ orders: [Record]) -> String {
        let keys = ["trackingNumber", "recipientName", "recipientPhone", "governorate", "city", "address", "amount", "deliveryFee", "status", "type", "createdAt"]
        func escaped(_ text: String) -> String {
            // Neutralize formula execution in spreadsheet programs on export.
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let safe = ["=", "+", "-", "@"].contains(where: { trimmed.hasPrefix($0) }) || text.hasPrefix("\t") || text.hasPrefix("\r") ? "'" + text : text
            return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        let rows = orders.map { order in keys.map { key in escaped(key == "amount" || key == "deliveryFee" ? String(order.n(key)) : order.s(key)) }.joined(separator: ",") }
        return "\u{FEFF}" + keys.joined(separator: ",") + "\r\n" + rows.joined(separator: "\r\n")
    }
}
