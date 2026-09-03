import type { IconName } from "../components/icon";
import { INTERIOR_LOCALITIES, WEST_BANK_LOCALITIES } from "./palestine-locations.generated.ts";

export type Role = "admin" | "merchant" | "courier";
export type Membership = "standard" | "premium" | "diamond";
export type LinkedDeviceType = "mobile" | "tablet" | "desktop" | "unknown";
export type LinkedDevice = {
  id: string;
  name: string;
  type: LinkedDeviceType;
  browser: string;
  current: boolean;
  createdAt: string;
  lastActiveAt: string;
};
export type OrderStatus =
  | "draft"
  | "ready"
  | "shipped"
  | "processing"
  | "delivered"
  | "stuck"
  | "returned"
  | "deferred";

export type TrackingEvent = {
  id: string;
  kind?: "status" | "note";
  status: OrderStatus;
  title: string;
  location: string;
  actor: string;
  note: string;
  createdAt: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  store: string;
  governorate?: string;
  city?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  role: Role;
  membership?: Membership;
  joinedAt: string;
  avatarColor: string;
};

export type Recipient = {
  id: string;
  merchantId: string;
  name: string;
  phone: string;
  governorate?: string;
  city: string;
  address: string;
  favorite: boolean;
};

export type Order = {
  id: string;
  trackingNumber: string;
  merchantId: string;
  merchantName: string;
  merchantStore: string;
  recipientName: string;
  recipientPhone: string;
  governorate?: string;
  city: string;
  address: string;
  pickupAddress: string;
  preferredDeliveryDate?: string;
  amount: number;
  deliveryFee: number;
  content: string;
  weight: string;
  dimensions: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightFee?: number;
  oversizeFee?: number;
  notes: string;
  privateNotes: string;
  reference: string;
  type: string;
  status: OrderStatus;
  courierName: string;
  courierId?: string;
  shippedAt?: string;
  trackingEvents?: TrackingEvent[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
};

export type TrackableOrder = Pick<Order, "id" | "trackingNumber" | "status" | "createdAt" | "updatedAt">
  & Partial<Pick<Order, "trackingEvents" | "merchantName" | "merchantStore" | "courierName">>;

export type CollectionInvoice = {
  id: string;
  merchantId: string;
  merchantName: string;
  invoiceNumber: string;
  orderIds: string[];
  grossAmount: number;
  deliveryFees: number;
  returnFees: number;
  netAmount: number;
  deliveredCount: number;
  returnedCount: number;
  status: "pending" | "ready" | "paid";
  verificationCode: string;
  authorizedRecipient: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string;
  /** وقت الإكمال القديم لفواتير كانت تُحفظ بحالة shipped قبل توحيد حالة التسليم. */
  shippedAt?: string;
  verifiedAt?: string;
  verifiedById?: string;
  verifiedByName?: string;
  paidAt?: string;
};

export type NoticeAudience = "all" | "merchants" | "couriers" | "premium" | "diamond" | "standard" | "user";

export type Notice = {
  id: string;
  userId: string | "all";
  title: string;
  message: string;
  icon: IconName;
  read: boolean;
  createdAt: string;
  orderId?: string;
  broadcastId?: string;
  audience?: NoticeAudience;
};

export type Preferences = {
  theme: "light" | "dark" | "system";
  notifications: boolean;
  sounds: boolean;
  orderUpdates: boolean;
  biometric: boolean;
  pin: string;
  rating: number;
  compact: boolean;
};

export type Database = {
  users: User[];
  orders: Order[];
  recipients: Recipient[];
  collections: CollectionInvoice[];
  notices: Notice[];
  preferences: Record<string, Preferences>;
  nextOrder: number;
  nextCollection: number;
};

export const defaultPreferences: Preferences = {
  theme: "light",
  notifications: true,
  sounds: true,
  orderUpdates: true,
  biometric: false,
  pin: "",
  rating: 0,
  compact: false,
};

export const statusDefinitions: {
  id: OrderStatus;
  label: string;
  icon: IconName;
  color: string;
  surface: string;
}[] = [
  { id: "draft", label: "قيد الإنشاء", icon: "edit", color: "#5b6470", surface: "#f0f2f4" },
  { id: "ready", label: "جاهز للإرسال", icon: "package", color: "#bc7629", surface: "#fff1df" },
  { id: "shipped", label: "مشحون", icon: "truck", color: "#6453b2", surface: "#efedff" },
  { id: "processing", label: "تمت المعالجة", icon: "clipboard", color: "#218391", surface: "#e2f5f5" },
  { id: "delivered", label: "واصل", icon: "check", color: "#168653", surface: "#e7f7ee" },
  { id: "stuck", label: "عالق", icon: "alert", color: "#bb4384", surface: "#fff0f8" },
  { id: "returned", label: "راجع", icon: "return", color: "#c35a52", surface: "#fff0ed" },
  { id: "deferred", label: "مؤجل", icon: "clock", color: "#8057b0", surface: "#f1eaff" },
];

function mergeLocalities(...groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  return groups.flatMap((group) => group.filter((name) => {
    const key = normalizeLocation(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

const curatedGovernorates = [
  {
    name: "الخليل", fee: 25, cities: [
      "الخليل", "دورا", "يطا", "الظاهرية", "حلحول", "إذنا", "سعير", "بيت أمر", "ترقوميا", "تفوح", "بني نعيم", "السموع", "بيت أولا", "خاراس", "نوبا", "صوريف", "الشيوخ", "خرسا", "دير سامت", "الكرمل", "الريحية", "بيت كاحل", "بيت عوا", "البرج", "المجد", "الكوم", "رابود", "زيف", "التوانة", "الرماضين", "خربة قلقس", "مخيم الفوار", "مخيم العروب",
    ],
  },
  {
    name: "بيت لحم", fee: 25, cities: [
      "بيت لحم", "بيت جالا", "بيت ساحور", "الدوحة", "الخضر", "تقوع", "العبيدية", "بيت فجار", "نحالين", "حوسان", "بتير", "وادي فوكين", "أرطاس", "زعترة", "جناتا", "دار صلاح", "الشواورة", "الولجة", "جورة الشمعة", "مراح رباح", "وادي رحال", "المعصرة", "خلة الحداد", "مخيم الدهيشة", "مخيم عايدة", "مخيم العزة",
    ],
  },
  {
    name: "رام الله والبيرة", fee: 25, cities: [
      "رام الله", "البيرة", "بيتونيا", "بيرزيت", "سلواد", "روابي", "سردا", "أبو قش", "عين عريك", "عين قينيا", "الجانية", "دير دبوان", "دير جرير", "دير غسانة", "بيت ريما", "مزارع النوباني", "كوبر", "كفر عين", "قراوة بني زيد", "عارورة", "عبوين", "سنجل", "ترمسعيا", "المزرعة الشرقية", "الطيبة", "رمون", "عين يبرود", "بيتين", "برقة", "مخماس", "جفنا", "أبو شخيدم", "نعلين", "بلعين", "دير قديس", "شقبا", "قبيا", "بدرس", "بيت لقيا", "بيت سيرا", "صفا", "خربثا بني حارث", "خربثا المصباح", "أم صفا", "عطارة", "عجول", "المغير", "دير السودان", "رنتيس", "دير أبو مشعل", "اللبن الغربي", "شبتين", "المدية", "مخيم الأمعري", "مخيم الجلزون", "مخيم دير عمار",
    ],
  },
  {
    name: "القدس", fee: 35, cities: [
      "القدس", "البلدة القديمة", "سلوان", "الثوري", "الطور", "العيسوية", "شعفاط", "بيت حنينا", "بيت صفافا", "شرفات", "صور باهر", "جبل المكبر", "أم طوبا", "وادي الجوز", "الشيخ جراح", "الصوانة", "رأس العامود", "كفر عقب", "قلنديا", "مخيم قلنديا", "مخيم شعفاط", "أبو ديس", "العيزرية", "السواحرة الشرقية", "السواحرة الغربية", "الرام", "ضاحية البريد", "بير نبالا", "الجيب", "بدّو", "بيت سوريك", "بيت إكسا", "قطنة", "بيت عنان", "القبيبة", "حزما", "عناتا", "الزعيم", "الشيخ سعد", "جبع", "رافات", "بيت دقو", "النبي صموئيل", "خربة أم اللحم",
    ],
  },
  {
    name: "نابلس", fee: 25, cities: [
      "نابلس", "حوارة", "عصيرة الشمالية", "بيتا", "سبسطية", "بيت فوريك", "بيت دجن", "روجيب", "عورتا", "بورين", "مادما", "عصيرة القبلية", "عوريف", "صرة", "تل", "عراق بورين", "زواتا", "بيت إيبا", "دير شرف", "قوصين", "نصف جبيل", "الناقورة", "الباذان", "طلوزة", "ياصيد", "برقة", "بزاريا", "جماعين", "زيتا جماعين", "عينابوس", "أودلا", "عقربا", "قبلان", "يتما", "الساوية", "اللبن الشرقية", "قريوت", "جالود", "دوما", "مجدل بني فاضل", "قصرة", "تلفيت", "فروش بيت دجن", "زعترة", "النصارية", "بيت حسن", "مخيم بلاطة", "مخيم عسكر", "مخيم عين بيت الماء",
    ],
  },
  {
    name: "جنين", fee: 25, cities: [
      "جنين", "قباطية", "يعبد", "عرابة", "برقين", "الزبابدة", "اليامون", "كفر دان", "كفر راعي", "ميثلون", "صانور", "جبع", "سيريس", "الجديدة", "سيلة الظهر", "الفندقومية", "عجة", "عنزة", "فحمة", "كفر قود", "دير أبو ضعيف", "الجلمة", "سيلة الحارثية", "رمانة", "زبوبا", "تعنك", "الطيبة", "عانين", "عرانة", "فقوعة", "جلبون", "بيت قاد", "برطعة الشرقية", "العرقة", "أم التوت", "مسلية", "دير غزالة", "عربونة", "كفيرت", "إمريحة", "الشهداء", "جلقموس", "المغير", "المطلة", "بير الباشا", "المنشية", "نزلة الشيخ زيد", "أم الريحان", "طورة الغربية", "طورة الشرقية", "مخيم جنين",
    ],
  },
  {
    name: "طولكرم", fee: 25, cities: [
      "طولكرم", "عتيل", "دير الغصون", "عنبتا", "بلعا", "اكتابا", "شويكة", "ذنابة", "كفر اللبد", "رامين", "سفارين", "بيت ليد", "كور", "كفر صور", "كفر زيباد", "كفر جمال", "كفر عبوش", "فرعون", "شوفة", "نزلة عيسى", "باقة الشرقية", "النزلة الشرقية", "النزلة الوسطى", "النزلة الغربية", "زيتا", "صيدا", "علار", "قفين", "الجاروشية", "المسقوفة", "مخيم طولكرم", "مخيم نور شمس",
    ],
  },
  {
    name: "قلقيلية", fee: 25, cities: [
      "قلقيلية", "عزون", "حبلة", "جيوس", "كفر قدوم", "جيت", "باقة الحطب", "حجة", "الفندق", "إماتين", "فرعتا", "النبي إلياس", "كفر لاقف", "جينصافوط", "رأس عطية", "رأس طيرة", "كفر ثلث", "سنيريا", "عزون عتمة", "بيت أمين", "فلامية", "الضبعة", "عرب الرماضين الجنوبي", "عرب أبو فردة", "وادي الرشا",
    ],
  },
  {
    name: "سلفيت", fee: 25, cities: [
      "سلفيت", "بديا", "دير استيا", "الزاوية", "بروقين", "كفر الديك", "قراوة بني حسان", "كفل حارس", "حارس", "دير بلوط", "رافات", "مردا", "ياسوف", "إسكاكا", "سرطة", "مسحة", "فرخة", "خربة قيس", "وادي قانا",
    ],
  },
  {
    name: "أريحا والأغوار", fee: 25, cities: [
      "أريحا", "العوجا", "عين السلطان", "الجفتلك", "عقبة جبر", "فصايل", "الزبيدات", "مرج نعجة", "مرج الغزال", "النويعمة", "الديوك الفوقا", "الديوك التحتا", "النبي موسى", "الخان الأحمر", "عين الديوك", "دير حجلة",
    ],
  },
  {
    name: "طوباس", fee: 25, cities: [
      "طوباس", "طمون", "عقابا", "تياسير", "الفارعة", "مخيم الفارعة", "وادي الفارعة", "عين البيضا", "بردلة", "كردلة", "إبزيق", "خربة عاطوف", "الرأس الأحمر", "المالح", "الحديدية", "حمصة", "يرزا", "خربة الراس الأحمر",
    ],
  },
  {
    name: "الداخل", fee: 80, cities: [
      "الداخل", "الناصرة", "يافة الناصرة", "الرينة", "المشهد", "عين ماهل", "إكسال", "دبورية", "طرعان", "كفر كنا", "كفر مندا", "عيلوط", "عيلبون", "البعينة نجيدات", "الشبلي أم الغنم", "كوكب أبو الهيجاء", "سخنين", "عرابة البطوف", "دير حنا", "المغار", "الرامة", "ساجور", "شفاعمرو", "طمرة", "كابول", "إعبلين", "شعب", "بسمة طبعون", "إبطن", "بير المكسور", "الزرازير", "منشية زبدة", "كعبية طباش حجاجرة", "طوبا الزنغرية", "كفر ياسيف", "أبو سنان", "يركا", "جولس", "جديدة المكر", "المزرعة", "البعنة", "دير الأسد", "نحف", "مجد الكروم", "كسرى سميع", "البقيعة", "حرفيش", "بيت جن", "الجش", "فسوطة", "معليا", "ترشيحا", "معلوت ترشيحا", "مجدل شمس", "مسعدة", "بقعاثا", "عين قنيا", "الغجر", "حيفا", "دالية الكرمل", "عسفيا", "أم الفحم", "عارة", "عرعرة", "كفر قرع", "باقة الغربية", "جت", "زلفة", "سالم", "مصمص", "مشيرفة", "معاوية", "ميسر", "الفريديس", "جسر الزرقاء", "الطيبة", "الطيرة", "قلنسوة", "كفر قاسم", "جلجولية", "كفر برا", "زيمر", "اللد", "الرملة", "يافا", "عكا", "نهاريا", "كرمئيل", "نتانيا", "هرتسليا", "تل أبيب", "بيتح تكفا", "بني براك", "رمات غان", "بات يام", "حولون", "ريشون لتسيون", "رحوفوت", "أشدود", "عسقلان", "كريات غات", "بئر السبع", "عراد", "ديمونا", "إيلات", "رهط", "حورة", "اللقية", "كسيفة", "تل السبع", "عرعرة النقب", "شقيب السلام", "أم بطين", "ترابين الصانع", "قصر السر", "بير هداج", "أبو تلول", "وادي النعم", "أبو قرينات", "طبريا", "صفد", "بيسان", "الخضيرة", "العفولة", "نوف هجليل", "أبو غوش", "عين رافة", "عين نقوبا",
    ],
  },
];

export const governorates = curatedGovernorates.map((region) => {
  const officialLocalities: readonly string[] = region.name === "الداخل"
    ? INTERIOR_LOCALITIES
    : WEST_BANK_LOCALITIES[region.name as keyof typeof WEST_BANK_LOCALITIES] ?? [];
  return { ...region, cities: mergeLocalities(officialLocalities, region.cities) };
});

export const deliveryLocalities = governorates.flatMap((region) => region.cities.map((name) => ({
  name,
  governorate: region.name,
})));

export function normalizeLocation(value: string): string {
  return value.trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670ـ]/g, "")
    .replace(/[()\[\]{}،,./\\_–—-]/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveDeliveryRegion(governorate: string, city = "") {
  const governorateName = normalizeLocation(governorate);
  const cityName = normalizeLocation(city);

  if (!governorateName && !cityName) return undefined;

  const matchingGovernorate = governorates.find((region) => normalizeLocation(region.name) === governorateName);
  const regionsFor = (location: string) => location
    ? governorates.filter((region) => region.cities.some((name) => normalizeLocation(name) === location))
    : [];
  const cityRegions = regionsFor(cityName);

  if (matchingGovernorate) {
    return !cityName || cityRegions.includes(matchingGovernorate) ? matchingGovernorate : undefined;
  }

  const locations = [governorateName, cityName];
  const requestedZone = locations.some((location) => location.includes("القدس"))
    ? governorates.find((region) => region.name === "القدس")
    : locations.some((location) => location.includes("الداخل") || location.includes("الخط الاخضر") || /(?:48|٤٨)/.test(location))
      ? governorates.find((region) => region.name === "الداخل")
      : undefined;
  if (requestedZone) {
    return !cityName || cityRegions.includes(requestedZone) ? requestedZone : undefined;
  }

  const matchingRegions = [...new Set([...regionsFor(governorateName), ...cityRegions])];
  return matchingRegions.length === 1 ? matchingRegions[0] : undefined;
}

export const deliveryPricing = {
  standard: { westBank: 25, jerusalem: 35, interior: 80 },
  premium: { westBank: 20, jerusalem: 30, interior: 65 },
  diamond: { westBank: 15, jerusalem: 25, interior: 55 },
} as const;

export const returnPricing = {
  standard: { westBank: 20, jerusalem: 30, interior: 50 },
  premium: { westBank: 15, jerusalem: 25, interior: 40 },
  diamond: { westBank: 10, jerusalem: 15, interior: 25 },
} as const;

export function normalizeMembership(membership?: string): Membership {
  if (membership === "diamond") return "diamond";
  if (membership === "premium") return "premium";
  return "standard";
}

export function getMembershipPrices(membership?: Membership) {
  return deliveryPricing[normalizeMembership(membership)];
}

export function getReturnMembershipPrices(membership?: Membership) {
  return returnPricing[normalizeMembership(membership)];
}

function getRegionalPrice(region: { name: string } | undefined, prices: { westBank: number; jerusalem: number; interior: number }): number {
  if (!region) return 0;
  if (region.name === "القدس") return prices.jerusalem;
  if (region.name === "الداخل") return prices.interior;
  return prices.westBank;
}

export function getDeliveryFee(region: { name: string } | undefined, membership?: Membership): number {
  return getRegionalPrice(region, getMembershipPrices(membership));
}

export function getReturnFee(region: { name: string } | undefined, membership?: Membership): number {
  return getRegionalPrice(region, getReturnMembershipPrices(membership));
}

export const OVERSIZE_DIMENSION_LIMIT_CM = 40;
export const OVERSIZE_DIMENSION_STEP_CM = 20;
export const OVERSIZE_FEE = 7;
export const MAX_OVERSIZE_FEE = 28;

export const WEIGHT_OPTIONS = [
  { label: "0 - 5 كغم", fee: 0 },
  { label: "5 - 10 كغم", fee: 5 },
  { label: "10 - 20 كغم", fee: 10 },
  { label: "20 - 30 كغم", fee: 15 },
  { label: "أكثر من 30 كغم", fee: 20 },
] as const;

export type WeightOption = typeof WEIGHT_OPTIONS[number]["label"];

export function normalizeWeightOption(value: string | null | undefined): WeightOption {
  const normalized = String(value ?? "").trim();
  return WEIGHT_OPTIONS.find((option) => option.label === normalized)?.label ?? WEIGHT_OPTIONS[0].label;
}

export function getWeightFee(value: string | null | undefined): number {
  const normalized = normalizeWeightOption(value);
  return WEIGHT_OPTIONS.find((option) => option.label === normalized)?.fee ?? 0;
}

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
}

function validDimension(value: number | string | null | undefined): number {
  const parsed = Number(typeof value === "string" ? normalizeDigits(value.trim()) : value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function parseDimensionCm(value: number | string | null | undefined): number | undefined {
  return validDimension(value) || undefined;
}

export function getOversizeFee(...dimensions: Array<number | string | null | undefined>): number {
  const largestDimension = Math.max(0, ...dimensions.map(validDimension));
  if (largestDimension <= OVERSIZE_DIMENSION_LIMIT_CM) return 0;
  const tier = Math.ceil((largestDimension - OVERSIZE_DIMENSION_LIMIT_CM) / OVERSIZE_DIMENSION_STEP_CM);
  return Math.min(tier * OVERSIZE_FEE, MAX_OVERSIZE_FEE);
}

function parsedOrderDimensions(value: string | undefined): [number, number, number] {
  const parsed = (normalizeDigits(String(value ?? "")).match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(validDimension);
  return [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0];
}

export function getOrderDimensions(order: Pick<Order, "dimensions" | "lengthCm" | "widthCm" | "heightCm">): [number, number, number] {
  const explicit: [number, number, number] = [validDimension(order.lengthCm), validDimension(order.widthCm), validDimension(order.heightCm)];
  return explicit.some(Boolean) ? explicit : parsedOrderDimensions(order.dimensions);
}

export function getOrderOversizeFee(order: Pick<Order, "dimensions" | "lengthCm" | "widthCm" | "heightCm">): number {
  return getOversizeFee(...getOrderDimensions(order));
}

const legacyDemoAccountIds = new Set([
  "merchant-amir",
  "merchant-naseem",
  "merchant-layan",
  "merchant-sami",
  "merchant-maya",
  "merchant-omar",
  "merchant-sara",
  "courier-mohammad",
]);

export function createSeedDatabase(): Database {
  return {
    users: [],
    orders: [],
    recipients: [],
    collections: [],
    notices: [],
    preferences: {},
    nextOrder: 20200001,
    nextCollection: 618000,
  };
}

export function removeLegacyDemoData(database: Database & { compensations?: unknown[] }): Database {
  const users = database.users.filter((account) => !legacyDemoAccountIds.has(account.id));
  const accountIds = new Set(users.map((account) => account.id));
  const merchantIds = new Set(users.filter((account) => account.role === "merchant").map((account) => account.id));
  const courierIdsByName = new Map<string, string | null>();
  for (const courier of users.filter((account) => account.role === "courier")) {
    const name = courier.name.trim();
    if (!name) continue;
    courierIdsByName.set(name, courierIdsByName.has(name) ? null : courier.id);
  }

  const orders = database.orders
    .filter((order) => merchantIds.has(order.merchantId))
    .map((order) => {
      if (order.courierId) return order;
      const courierId = courierIdsByName.get(order.courierName.trim());
      return courierId ? { ...order, courierId } : order;
    });

  const collections = (database.collections ?? [])
    .filter((invoice) => merchantIds.has(invoice.merchantId))
    .map((invoice) => {
      const legacyStatus = String(invoice.status);
      if (legacyStatus !== "shipped" && legacyStatus !== "delivered") return invoice;

      const legacyDeliveredAt = (invoice as CollectionInvoice & { deliveredAt?: string }).deliveredAt;
      return {
        ...invoice,
        status: "paid" as const,
        paidAt: invoice.paidAt ?? legacyDeliveredAt ?? invoice.verifiedAt ?? invoice.shippedAt ?? invoice.updatedAt,
      };
    });

  return {
    users,
    orders,
    recipients: database.recipients.filter((recipient) => merchantIds.has(recipient.merchantId)),
    collections,
    notices: database.notices.filter((notice) => accountIds.has(notice.userId)),
    preferences: Object.fromEntries(Object.entries(database.preferences ?? {})
      .filter(([accountId]) => accountIds.has(accountId))
      .map(([accountId, preference]) => [accountId, { ...preference, biometric: false, pin: "" }])),
    nextOrder: Math.max(20200001, database.nextOrder || 20200001),
    nextCollection: Math.max(618000, database.nextCollection || 618000),
  };
}

export function uid(prefix = "item"): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${randomPart}`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ar-PS", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

export function relativeDate(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

export function money(value: number): string {
  return new Intl.NumberFormat("ar-PS", { maximumFractionDigits: 0 }).format(value);
}

export function getStatus(status: OrderStatus) {
  return statusDefinitions.find((item) => item.id === status) ?? statusDefinitions[0];
}

const trackingEventDefaults: Record<OrderStatus, { location: string; note: string }> = {
  draft: { location: "مع المرسل", note: "تم تسجيل بيانات الطرد." },
  ready: { location: "مع المرسل", note: "الطرد جاهز لاستلامه من المرسل." },
  shipped: { location: "مع السائق", note: "استلم المندوب الطرد وبدأت رحلة التوصيل." },
  processing: { location: "مركز الفرز", note: "تمت معالجة الطرد وتجهيزه للتوزيع." },
  delivered: { location: "تم التسليم", note: "تم تسليم الطرد إلى المستلم بنجاح." },
  stuck: { location: "قيد المتابعة", note: "يحتاج الطرد إلى متابعة من فريق العمليات." },
  returned: { location: "في طريق الرجوع", note: "تم تسجيل الطرد كراجع إلى المرسل." },
  deferred: { location: "بانتظار الموعد", note: "تم تأجيل التوصيل إلى موعد لاحق." },
};

export function createTrackingEvent(status: OrderStatus, actor: string, options: { location?: string; note?: string; createdAt?: string } = {}): TrackingEvent {
  const defaults = trackingEventDefaults[status];
  return {
    id: uid("tracking"),
    kind: "status",
    status,
    title: getStatus(status).label,
    location: options.location?.trim() || defaults.location,
    actor: actor.trim() || "فريق المدينة إكسبرس",
    note: options.note?.trim() || defaults.note,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

export function getOrderTrackingEvents(order: TrackableOrder): TrackingEvent[] {
  const stored = Array.isArray(order.trackingEvents)
    ? order.trackingEvents.filter((event) => event && typeof event.id === "string" && typeof event.createdAt === "string")
    : [];
  if (stored.length) {
    const sorted = [...stored].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    const latest = sorted[sorted.length - 1];
    if (latest.status === order.status) return sorted;

    const currentDefaults = trackingEventDefaults[order.status];
    return [...sorted, {
      id: `${order.id}-current-${order.status}`,
      status: order.status,
      title: getStatus(order.status).label,
      location: currentDefaults.location,
      actor: order.courierName && order.courierName !== "بانتظار تعيين المندوب" ? order.courierName : "فريق المدينة إكسبرس",
      note: currentDefaults.note,
      createdAt: order.updatedAt.localeCompare(latest.createdAt) >= 0 ? order.updatedAt : latest.createdAt,
    }].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }

  const initialStatus: OrderStatus = order.status === "draft" ? "draft" : "ready";
  const initialDefaults = trackingEventDefaults[initialStatus];
  const initial: TrackingEvent = {
    id: `${order.id}-created`,
    status: initialStatus,
    title: getStatus(initialStatus).label,
    location: initialDefaults.location,
    actor: order.merchantName || order.merchantStore || "المرسل",
    note: "تم إنشاء الطرد وتسجيل بياناته.",
    createdAt: order.createdAt,
  };

  if (order.status === initialStatus) return [initial];
  const currentDefaults = trackingEventDefaults[order.status];
  return [initial, {
    id: `${order.id}-current`,
    status: order.status,
    title: getStatus(order.status).label,
    location: currentDefaults.location,
    actor: order.courierName && order.courierName !== "بانتظار تعيين المندوب" ? order.courierName : "فريق المدينة إكسبرس",
    note: currentDefaults.note,
    createdAt: order.updatedAt,
  }];
}

export function appendOrderTrackingEvent(order: Order, status: OrderStatus, actor: string, note?: string): Order {
  if (order.status === status) return order;
  const now = new Date().toISOString();
  const event = createTrackingEvent(status, actor, { note, createdAt: now });
  return { ...order, status, updatedAt: now, trackingEvents: [...getOrderTrackingEvents(order), event] };
}

export function appendOrderTrackingNote(order: Order, actor: string, note: string): Order {
  const text = note.trim().slice(0, 500);
  if (!text) return order;

  const now = new Date().toISOString();
  const events = getOrderTrackingEvents(order);
  const latest = events.at(-1);
  const event = createTrackingEvent(order.status, actor, {
    location: latest?.location,
    note: text,
    createdAt: now,
  });

  event.kind = "note";
  event.title = `ملاحظة — ${getStatus(order.status).label}`;
  return { ...order, updatedAt: now, trackingEvents: [...events, event] };
}
