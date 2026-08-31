import type { IconName } from "../components/icon";

export type Role = "admin" | "merchant" | "courier";
export type Membership = "standard" | "premium";
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
  status: "pending" | "ready" | "shipped" | "paid";
  verificationCode: string;
  authorizedRecipient: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string;
  shippedAt?: string;
  verifiedAt?: string;
  verifiedById?: string;
  verifiedByName?: string;
  paidAt?: string;
};

export type NoticeAudience = "all" | "merchants" | "couriers";

export type Notice = {
  id: string;
  userId: string | "all";
  title: string;
  message: string;
  icon: IconName;
  read: boolean;
  createdAt: string;
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
  sounds: false,
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

export const governorates = [
  { name: "الخليل", fee: 25, cities: ["الخليل", "دورا", "يطا", "الظاهرية", "حلحول", "إذنا", "سعير", "بيت أمر"] },
  { name: "بيت لحم", fee: 25, cities: ["بيت لحم", "بيت جالا", "بيت ساحور", "الدوحة", "الخضر"] },
  { name: "رام الله والبيرة", fee: 25, cities: ["رام الله", "البيرة", "بيتونيا", "بيرزيت", "سلواد"] },
  { name: "القدس", fee: 35, cities: ["القدس", "أبو ديس", "العيزرية", "الرام", "بدّو"] },
  { name: "نابلس", fee: 25, cities: ["نابلس", "حوارة", "عصيرة الشمالية", "بيتا", "سبسطية"] },
  { name: "جنين", fee: 25, cities: ["جنين", "قباطية", "يعبد", "عرابة", "برقين"] },
  { name: "طولكرم", fee: 25, cities: ["طولكرم", "عتيل", "دير الغصون", "عنبتا"] },
  { name: "قلقيلية", fee: 25, cities: ["قلقيلية", "عزون", "حبلة", "جيوس"] },
  { name: "سلفيت", fee: 25, cities: ["سلفيت", "بديا", "دير استيا", "الزاوية"] },
  { name: "أريحا والأغوار", fee: 25, cities: ["أريحا", "العوجا", "عين السلطان", "الجفتلك"] },
  { name: "طوباس", fee: 25, cities: ["طوباس", "طمون", "عقابا", "تياسير"] },
  { name: "الداخل", fee: 80, cities: ["الداخل", "الناصرة", "حيفا", "يافا", "عكا", "اللد", "الرملة", "أم الفحم", "سخنين", "الطيبة", "الطيرة", "رهط", "شفاعمرو", "كفر قاسم"] },
];

function normalizeLocation(value: string): string {
  return value.trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670ـ]/g, "")
    .replace(/\s+/g, " ");
}

export function resolveDeliveryRegion(governorate: string, city = "") {
  const governorateName = normalizeLocation(governorate);
  const cityName = normalizeLocation(city);

  if (!governorateName && !cityName) return undefined;

  const matchingGovernorate = governorates.find((region) => normalizeLocation(region.name) === governorateName);
  if (matchingGovernorate) return matchingGovernorate;

  const locations = [governorateName, cityName];
  if (locations.some((location) => location.includes("القدس"))) {
    return governorates.find((region) => region.name === "القدس");
  }

  if (locations.some((location) => location.includes("الداخل") || location.includes("الخط الاخضر") || /(?:48|٤٨)/.test(location))) {
    return governorates.find((region) => region.name === "الداخل");
  }

  const matchingCity = governorates.find((region) => region.cities.some((name) => {
    const normalized = normalizeLocation(name);
    return normalized === governorateName || normalized === cityName;
  }));

  return matchingCity ?? governorates[0];
}

export const deliveryPricing = {
  standard: { westBank: 25, jerusalem: 35, interior: 80 },
  premium: { westBank: 20, jerusalem: 30, interior: 65 },
} as const;

export function getMembershipPrices(membership?: Membership) {
  return deliveryPricing[membership === "premium" ? "premium" : "standard"];
}

export function getDeliveryFee(region: { name: string } | undefined, membership?: Membership): number {
  if (!region) return 0;

  const prices = getMembershipPrices(membership);
  if (region.name === "القدس") return prices.jerusalem;
  if (region.name === "الداخل") return prices.interior;
  return prices.westBank;
}

export const OVERSIZE_DIMENSION_LIMIT_CM = 40;
export const OVERSIZE_FEE = 7;

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
  return dimensions.some((dimension) => validDimension(dimension) > OVERSIZE_DIMENSION_LIMIT_CM) ? OVERSIZE_FEE : 0;
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
  const admin: User = {
    id: "admin-almadina",
    name: "إدارة المدينة إكسبرس",
    email: "admin@almadinaexpress.com",
    password: "Admin@123",
    phone: "0599000000",
    store: "المدينة إكسبرس",
    role: "admin",
    joinedAt: new Date().toISOString(),
    avatarColor: "#087c45",
  };

  return {
    users: [admin],
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

  return {
    users,
    orders,
    recipients: database.recipients.filter((recipient) => merchantIds.has(recipient.merchantId)),
    collections: (database.collections ?? []).filter((invoice) => merchantIds.has(invoice.merchantId)),
    notices: database.notices.filter((notice) => accountIds.has(notice.userId)),
    preferences: Object.fromEntries(Object.entries(database.preferences ?? {}).filter(([accountId]) => accountIds.has(accountId))),
    nextOrder: Math.max(20200001, database.nextOrder || 20200001),
    nextCollection: Math.max(618000, database.nextCollection || 618000),
  };
}

export function uid(prefix = "item"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

export function getOrderTrackingEvents(order: Order): TrackingEvent[] {
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
