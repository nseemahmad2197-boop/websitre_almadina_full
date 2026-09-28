"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { bindFollowupAccount, followupApi } from "../lib/followup-client";
import type { FollowupCustomer, FollowupCustomerList } from "../lib/followups";
import { FollowupCollection } from "./followups";
import { OrderCard } from "./dashboard";
import { Button, EmptyState, Field, PageHeader } from "./ui";
import { LoadingSkeleton, RefreshStatus, RequestFailure } from "./server-state";

export function CustomerFollowupsPage() {
  const { user, setView } = useApp();
  if (!user || !["admin", "courier"].includes(user.role)) return <EmptyState icon="lock" title="هذه الصفحة لفريق المتابعة" description="يمكنك الوصول إلى متابعات طرودك من صفحة المتابعات." />;
  return <div className="page-content customer-followups-page"><PageHeader title="متابعات المستخدمين" subtitle="اختر اسم المستخدم للاطلاع على طروده وطلبات متابعته" onBack={() => setView(user.role === "admin" ? "admin" : "home")} /><CustomerWorkspace key={user.id} accountId={user.id} /></div>;
}

function validCustomer(value: unknown): value is FollowupCustomer {
  if (!value || typeof value !== "object") return false;
  const row = value as FollowupCustomer;
  return [row.id, row.name, row.store].every((value) => typeof value === "string") && !!row.id
    && [row.orderCount, row.followupCount, row.openCount].every((value) => Number.isSafeInteger(value) && value >= 0)
    && row.openCount <= row.followupCount;
}

function CustomerWorkspace({ accountId }: { accountId: string }) {
  const { database } = useApp();
  const [selected, setSelected] = useState<FollowupCustomer | null>(null);
  const [tab, setTab] = useState<"followups" | "parcels">("followups");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); setQuery(search.trim()); }
  if (selected) {
    const orders = database.orders.filter((order) => !order.deleted && order.merchantId === selected.id);
    return <div className="customer-workspace">
      <Button variant="ghost" onClick={() => setSelected(null)}>العودة إلى أسماء المستخدمين</Button>
      <header className="customer-workspace__heading"><h2>{selected.name}</h2><p>{selected.store || "مستخدم"}</p></header>
      <div className="filter-scroll" aria-label="عرض بيانات المستخدم"><button type="button" className={`filter-chip ${tab === "followups" ? "is-active" : ""}`} aria-pressed={tab === "followups"} onClick={() => setTab("followups")}>المتابعات</button><button type="button" className={`filter-chip ${tab === "parcels" ? "is-active" : ""}`} aria-pressed={tab === "parcels"} onClick={() => setTab("parcels")}>الطرود ({orders.length.toLocaleString("ar-EG")})</button></div>
      {tab === "followups" ? <FollowupCollection key={`${accountId}:${selected.id}`} accountId={accountId} merchantId={selected.id} /> : <div className="customer-parcels">{orders.length ? orders.map((order) => <OrderCard key={order.id} order={order} showMerchant />) : <EmptyState icon="package" title="لا توجد طرود" description="لا توجد طرود متاحة لهذا المستخدم حاليًا." />}</div>}
    </div>;
  }
  return <><form className="customer-search" onSubmit={submit}><Field label="البحث باسم المستخدم أو المتجر" icon="search" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="اكتب الاسم ثم اضغط بحث" /><Button type="submit" icon="search">بحث</Button></form><CustomerDirectory key={`${accountId}:${query}`} accountId={accountId} query={query} onSelect={(customer) => { setSelected(customer); setTab("followups"); }} /></>;
}

function CustomerDirectory({ accountId, query, onSelect }: { accountId: string; query: string; onSelect: (customer: FollowupCustomer) => void }) {
  const [customers, setCustomers] = useState<FollowupCustomer[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const loadNumber = useRef(0);
  async function load(cursor?: string) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    bindFollowupAccount(request.signal, accountId);
    const number = ++loadNumber.current;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await followupApi<FollowupCustomerList>(`followups/customers?${params}`, request.signal);
      if (request.signal.aborted || number !== loadNumber.current) return;
      if (!Array.isArray(result.customers) || !result.customers.every(validCustomer) || (result.nextCursor !== null && typeof result.nextCursor !== "string")) throw new Error("تعذّر قراءة قائمة المستخدمين.");
      setCustomers((previous) => cursor ? [...previous, ...result.customers.filter((item) => !previous.some((old) => old.id === item.id))] : result.customers);
      setNext(result.nextCursor);
      setLoaded(true);
    } catch (error) { if (!request.signal.aborted && number === loadNumber.current) setError(error instanceof Error ? error.message : "تعذّر الاتصال. حاول مجددًا."); }
    finally { if (!request.signal.aborted && number === loadNumber.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { controller.current?.abort(); }; }, [accountId, query]);
  return <section aria-label="أسماء المستخدمين">
    <div className="followup-toolbar"><Button variant="ghost" disabled={loading} onClick={() => void load()}>تحديث المستخدمين</Button>{loaded && <span aria-live="polite">{customers.length.toLocaleString("ar-EG")} مستخدم</span>}</div>
    {loading && (loaded ? <RefreshStatus label="جارٍ تحديث المستخدمين…" /> : <LoadingSkeleton kind="customers" label="جارٍ تحميل المستخدمين…" />)}
    {error && <RequestFailure message={error} onRetry={() => void load()} busy={loading} compact={loaded} />}
    {loaded && !loading && !error && !customers.length && <EmptyState icon="users" title="لا توجد نتائج" description="جرّب اسم المستخدم أو اسم متجره." />}
    <div className="customer-directory">{customers.map((customer) => <button type="button" className="customer-card" key={customer.id} onClick={() => onSelect(customer)}>
      <strong>{customer.name}</strong><span>{customer.store || "مستخدم"}</span>
      <dl><div><dt>الطرود</dt><dd>{customer.orderCount.toLocaleString("ar-EG")}</dd></div><div><dt>المتابعات</dt><dd>{customer.followupCount.toLocaleString("ar-EG")}</dd></div><div><dt>تحتاج متابعة</dt><dd>{customer.openCount.toLocaleString("ar-EG")}</dd></div></dl><span className="customer-card__open">عرض الطرود والمتابعات</span>
    </button>)}</div>
    {next && <Button variant="outline" loading={loading} onClick={() => void load(next)}>عرض المزيد من المستخدمين</Button>}
  </section>;
}
