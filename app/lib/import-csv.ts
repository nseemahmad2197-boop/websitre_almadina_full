export type ParcelImportCsvLayout = "governorate-city" | "legacy-region";

export type ParcelImportRow = {
  name: string;
  phone: string;
  governorate: string;
  city: string;
  address: string;
  amount: string;
  content: string;
  length: string;
  width: string;
  height: string;
  weight: string;
};

export type ParsedParcelImportCsv = {
  layout: ParcelImportCsvLayout;
  rows: ParcelImportRow[];
};

function parseCsvTable(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const finishCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const finishRow = () => {
    finishCell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      finishCell();
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      cell += character;
    }
  }
  if (cell || row.length) finishRow();
  return rows;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[()\[\]{}،,./\\_–—-]/g, " ")
    .replace(/\s+/g, " ");
}

function findColumn(headers: string[], names: string[], fallback: number): number {
  const normalizedNames = names.map(normalizeHeader);
  const index = headers.findIndex((header) => normalizedNames.includes(header));
  return index >= 0 ? index : fallback;
}

export function parseParcelImportCsv(input: string): ParsedParcelImportCsv {
  const table = parseCsvTable(input.replace(/^\uFEFF/, ""));
  if (table.length < 2) return { layout: "governorate-city", rows: [] };

  const headers = table[0].map(normalizeHeader);
  const governorateColumn = headers.findIndex((header) => header === normalizeHeader("المحافظة"));
  const cityColumn = headers.findIndex((header) => ["المدينه", "المنطقه"].includes(header));
  const layout: ParcelImportCsvLayout = governorateColumn >= 0 && cityColumn >= 0
    ? "governorate-city"
    : "legacy-region";
  const shift = layout === "governorate-city" ? 1 : 0;

  const columns = {
    name: findColumn(headers, ["الاسم", "اسم المستلم"], 0),
    phone: findColumn(headers, ["رقم الجوال", "الجوال", "الهاتف"], 1),
    governorate: layout === "governorate-city" ? governorateColumn : -1,
    city: cityColumn >= 0 ? cityColumn : 2,
    address: findColumn(headers, ["العنوان"], 3 + shift),
    amount: findColumn(headers, ["القيمة", "المبلغ"], 4 + shift),
    content: findColumn(headers, ["الوصف", "المحتوى"], 5 + shift),
    length: findColumn(headers, ["الطول سم", "الطول"], 6 + shift),
    width: findColumn(headers, ["العرض سم", "العرض"], 7 + shift),
    height: findColumn(headers, ["الارتفاع سم", "الارتفاع"], 8 + shift),
    weight: findColumn(headers, ["الوزن"], 9 + shift),
  };

  const valueAt = (row: string[], index: number) => index >= 0 ? row[index]?.trim() ?? "" : "";
  const rows = table.slice(1, 1_001).map((row): ParcelImportRow => ({
    name: valueAt(row, columns.name),
    phone: valueAt(row, columns.phone),
    governorate: valueAt(row, columns.governorate),
    city: valueAt(row, columns.city),
    address: valueAt(row, columns.address),
    amount: valueAt(row, columns.amount),
    content: valueAt(row, columns.content),
    length: valueAt(row, columns.length),
    width: valueAt(row, columns.width),
    height: valueAt(row, columns.height),
    weight: valueAt(row, columns.weight),
  }));

  return { layout, rows };
}
