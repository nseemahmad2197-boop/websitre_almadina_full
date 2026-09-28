"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { bindFollowupAccount, followupApi, FollowupApiError } from "../lib/followup-client";
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
  const { database, navigationDetails, updateNavigationDetails } = useApp();
  const [selected, setSelected] = useState<Pick<FollowupCustomer, "id" | "name" | "store"> | null>(null);
  const [localTab, setLocalTab] = useState<"followups" | "parcels">("followups");
  const tab = navigationDetails?.customerTab ?? localTab;
  const restoreId = navigationDetails?.customerId ?? null;
  const [restoreError, setRestoreError] = useState("");
  const [restoreRetry, setRestoreRetry] = useState(0);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  function setTab(value: "followups" | "parcels") {
    setLocalTab(value); updateNavigationDetails?.({ customerTab: value, followupId: null, followupOrderId: null });
  }
  function select(customer: FollowupCustomer | null) {
    setSelected(customer); setLocalTab("followups"); setRestoreError("");
    updateNavigationDetails?.({ customerId: customer?.id ?? null, customerTab: "followups", followupId: null, followupOrderId: null });
  }
  useEffect(() => {
    if (!restoreId || selected?.id === restoreId) return;
    const request = new AbortController(); bindFollowupAccount(request.signal, accountId);
    const snapshotUser = database.users.find((entry) => entry.id === restoreId && entry.role === "merchant");
    const snapshotOrder = database.orders.find((entry) => !entry.deleted && entry.merchantId === restoreId);
    // Only reconstruct display data from this account's authenticated snapshot.
    if (snapshotUser || snapshotOrder) {
      setSelected({ id: restoreId, name: snapshotUser?.name ?? snapshotOrder!.merchantName, store: snapshotUser?.store ?? snapshotOrder!.merchantStore });
      return;
    }
    function unavailable() { setNotice("لم يعد هذا المستخدم متاحًا في القائمة."); select(null); }
    setRestoreError("");
    void (async () => {
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const params = new URLSearchParams({ q: restoreId });
        if (cursor) params.set("cursor", cursor);
        const result: FollowupCustomerList = await followupApi<FollowupCustomerList>(`followups/customers?${params}`, request.signal);
        if (request.signal.aborted) return;
        if (!Array.isArray(result.customers) || !result.customers.every(validCustomer) || (result.nextCursor !== null && typeof result.nextCursor !== "string")) throw new Error("تعذّر قراءة قائمة المستخدمين.");
        const customer = result.customers.find((entry) => entry.id === restoreId);
        if (customer) { setSelected(customer); return; }
        cursor = result.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error("تعذّر استعادة المستخدم. حاول مجددًا.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      unavailable();
    })().catch((error: unknown) => {
      if (request.signal.aborted) return;
      if (error instanceof FollowupApiError && [403, 404, 410].includes(error.status)) unavailable();
      else setRestoreError(error instanceof Error ? error.message : "تعذّر الاتصال. حاول مجددًا.");
    });
    return () => request.abort();
  }, [accountId, restoreId, selected?.id, restoreRetry]);
  function submit(event: FormEvent) { event.preventDefault(); setQuery(search.trim()); }
  if (restoreId && !selected) return <div className="customer-workspace">
    <Button variant="ghost" onClick={() => select(null)}>العودة إلى أسماء المستخدمين</Button>
    {restoreError ? <RequestFailure message={restoreError} onRetry={() => setRestoreRetry((value) => value + 1)} /> : <LoadingSkeleton kind="customer-detail" label="جارٍ استعادة صفحة المستخدم…" />}
  </div>;
  if (selected) {
    const orders = database.orders.filter((order) => !order.deleted && order.merchantId === selected.id);
    return <div className="customer-workspace">
      <Button variant="ghost" onClick={() => select(null)}>العودة إلى أسماء المستخدمين</Button>
      <header className="customer-workspace__heading"><h2>{selected.name}</h2><p>{selected.store || "مستخدم"}</p></header>
      <div className="filter-scroll" aria-label="عرض بيانات المستخدم"><button type="button" className={`filter-chip ${tab === "followups" ? "is-active" : ""}`} aria-pressed={tab === "followups"} onClick={() => setTab("followups")}>المتابعات</button><button type="button" className={`filter-chip ${tab === "parcels" ? "is-active" : ""}`} aria-pressed={tab === "parcels"} onClick={() => setTab("parcels")}>الطرود ({orders.length.toLocaleString("ar-EG")})</button></div>
      {tab === "followups" ? <FollowupCollection key={`${accountId}:${selected.id}`} accountId={accountId} merchantId={selected.id} /> : <div className="customer-parcels">{orders.length ? orders.map((order) => <OrderCard key={order.id} order={order} showMerchant />) : <EmptyState icon="package" title="لا توجد طرود" description="لا توجد طرود متاحة لهذا المستخدم حاليًا." />}</div>}
    </div>;
  }
  return <>{notice && <p role="status">{notice}</p>}<form className="customer-search" onSubmit={submit}><Field label="البحث باسم المستخدم أو المتجر" icon="search" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="اكتب الاسم ثم اضغط بحث" /><Button type="submit" icon="search">بحث</Button></form><CustomerDirectory key={`${accountId}:${query}`} accountId={accountId} query={query} onSelect={select} /></>;
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
