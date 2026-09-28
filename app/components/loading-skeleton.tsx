"use client";

import type { ReactNode } from "react";
import { NAVIGATION_STORAGE_KEY } from "../lib/navigation-state";
import { statusDefinitions } from "../lib/data";

export type SkeletonKind = "dashboard" | "admin" | "admin-users" | "admin-collections" | "admin-couriers" | "staff-parcels" | "staff-followup-detail" | "employee" | "parcels" | "returns" | "collections" | "invoice" | "order" | "followups" | "followup-detail" | "customers" | "customer-detail" | "conversation" | "devices" | "notifications" | "recipients" | "settings" | "profile" | "form" | "security" | "password" | "preferences" | "help" | "privacy" | "codes" | "deletion-requests" | "delete-account" | "tracking" | "attachment" | "import";
const Shape = ({ className = "" }: { className?: string }) => <span className={`loading-shape ${className}`} />;
const Line = ({ size = "" }: { size?: string }) => <Shape className={`loading-line ${size ? `loading-line--${size}` : ""}`} />;
const Lines = () => <div className="loading-lines"><Line size="title" /><Line /><Line size="short" /></div>;
const Panel = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={`loading-panel ${className}`}>{children}</div>;
const Pair = ({ children }: { children: ReactNode }) => <div className="loading-pair">{children}</div>;
const Filters = ({count=4}: {count?:number}) => <div className="loading-filters">{Array.from({length:count},(_,index) => <Shape key={index} className="loading-badge" />)}</div>;
const Search = () => <Shape className="loading-input loading-search" />;
function Metrics({ count = 2 }: { count?: number }) { return <div className="loading-metrics">{Array.from({length:count},(_,index) => <Panel key={index}><Line size="amount" /><Line size="short" /></Panel>)}</div>; }
function Fields({ count = 4 }: { count?: number }) { return <div className="loading-fields">{Array.from({length:count},(_,index) => <div className="loading-field" key={index}><Line size="short" /><Shape className="loading-input" /></div>)}</div>; }
function Timeline() { return <div className="loading-timeline">{[0,1,2].map(index => <div className="loading-timeline-step" key={index}><Shape className="loading-dot" /><Lines /></div>)}</div>; }
function ParcelRows({ rows }: { rows: number }) { return <div className="loading-rows">{Array.from({length:rows},(_,index) => <div className="order-card loading-parcel" key={index}><div className="order-card__top"><div className="order-card__identity"><Shape className="loading-square"/><div className="loading-lines"><Line size="title"/><Line size="short"/></div></div><Shape className="loading-badge"/></div><div className="order-card__details"><Line size="short"/><Line size="short"/><Line size="short"/></div></div>)}</div>; }
function PersonRows({ rows, recipient = false }: { rows: number; recipient?: boolean }) { return <div className="loading-rows">{Array.from({length:rows},(_,index) => recipient ? <div className="recipient-card loading-recipient" key={index}><Shape className="loading-square"/><div className="loading-lines"><Line size="title"/><Line size="short"/><Line/></div><Shape className="loading-square loading-square--small"/></div> : <div className="customer-card loading-customer" key={index}><Line size="title"/><Line size="short"/><div className="loading-counts">{[0,1,2].map(value => <div key={value}><Line size="title"/><Line size="short"/></div>)}</div><Line size="title"/></div>)}</div>; }
function FollowupRows({ rows }: { rows: number }) { return <div className="loading-rows">{Array.from({length:rows},(_,index) => <Panel className="loading-followup" key={index}><Pair><Shape className="loading-badge" /><Line size="short" /></Pair><Line size="title" /><Line /><Pair><Line size="short" /><Line size="short" /></Pair></Panel>)}</div>; }
function InvoiceRows({ rows }: { rows: number }) { return <div className="loading-rows">{Array.from({length:rows},(_,index) => <div className="collection-card loading-invoice" key={index}><div className="collection-card__main"><Line size="title"/><Shape className="loading-badge"/><Line/><Line/></div><div className="collection-card__numbers"><Line size="amount"/><Line/><Line/></div></div>)}</div>; }
function SettingRows({ rows = 4, switches = false }: { rows?: number; switches?: boolean }) { return <Panel>{Array.from({length:rows},(_,index) => <Pair key={index}><Shape className="loading-square loading-square--small" /><Lines /><Shape className={switches ? "loading-switch" : "loading-chevron"} /></Pair>)}</Panel>; }
function Dashboard() { return <><div className="loading-greeting"><Line size="short" /><Line size="heading" /></div><div className="loading-hero"><Line size="short" /><Line size="amount" /><div className="loading-stats">{[0,1].map(index => <div key={index}><Shape className="loading-avatar" /><Line size="short" /><Line /></div>)}</div><Line /></div><div className="loading-section-title"><Line size="title" /></div><div className="loading-status-grid">{statusDefinitions.map(status => <div className="loading-status-card" key={status.id}><Shape className="loading-avatar" /><Line size="short" /><Line /></div>)}</div><Filters /><ParcelRows rows={2} /></>; }
function PageHeading() { return <div className="loading-page-heading"><div className="loading-lines"><Line size="heading"/><Line size="short"/></div><Shape className="loading-button"/></div>; }
function AdminStats() { return <div className="admin-stats loading-admin-stats">{[0,1,2,3].map(index=><div className={`admin-stat ${index===3?"admin-stat--courier":""}`} key={index}><Shape className="loading-square"/><Line size="amount"/><Line size="short"/></div>)}</div>; }
function AdminOrders({rows}: {rows:number}) { return <div className="admin-order-list">{Array.from({length:rows},(_,index)=><div className="admin-order-card loading-admin-order" key={index}><div className="admin-order-card__headline"><div className="loading-lines"><Line size="title"/><Line size="short"/></div><Shape className="loading-badge"/></div><div className="admin-order-card__meta">{[0,1,2,3].map(value=><Line size="short" key={value}/>)}</div><div className="admin-status-buttons loading-status-actions">{[...statusDefinitions, {id:"delete"}].map(status=><Shape key={status.id} className="loading-badge"/>)}</div></div>)}</div>; }
function AdminAccounts({rows,couriers=false}: {rows:number;couriers?:boolean}) { return <div className="admin-user-list">{Array.from({length:rows},(_,index)=><div className={`admin-user-card admin-user-card--${couriers?"courier":"merchant"} loading-admin-account`} key={index}><Shape className="avatar loading-avatar"/><div className="admin-user-card__body"><div className="admin-user-card__identity"><Line size="title"/>{!couriers&&<Shape className="loading-badge"/>}</div><Line/><Line/><Line size="short"/></div><div className={`admin-user-card__actions ${couriers?"admin-user-card__actions--courier":""}`}>{!couriers&&<div className="membership-switch">{[0,1,2].map(value=><Shape key={value} className="membership-switch__option loading-membership"/>)}</div>}<Shape className="loading-square loading-square--small"/><Shape className="loading-square loading-square--small"/></div></div>)}</div>; }
function StaffInvoices({rows,employee=false}: {rows:number;employee?:boolean}) { return <div className={employee?"employee-collection-list":"admin-collections"}>{Array.from({length:rows},(_,index)=>employee?<div className="employee-collection-card loading-staff-invoice" key={index}><Shape className="employee-collection-card__icon loading-square"/><div className="loading-lines"><Line size="title"/><Line size="short"/><Line/></div><Shape className="loading-badge"/><footer><Line size="amount"/><Shape className="loading-button"/></footer></div>:<div className="admin-collection-card loading-staff-invoice" key={index}><div><Shape className="avatar loading-avatar"/><div className="loading-lines"><Line size="title"/><Line size="short"/></div><Shape className="loading-badge"/></div><Line/><footer><Line size="amount"/><Shape className="loading-button"/></footer></div>)}</div>; }
function AdminCollectionAccounts() { return <div className="admin-collection-accounts loading-account-picker"><header><Lines/><Shape className="loading-button"/></header><div className="admin-collection-accounts__list">{[0,1,2].map(index=><div className="admin-collection-account" key={index}><Shape className="avatar loading-avatar"/><span className="admin-collection-account__identity"><Line size="title"/><Line/></span><span className="admin-collection-account__meta"><Line size="short"/><Line size="short"/></span></div>)}</div></div>; }
function AdminLayout({kind,rows}: {kind:SkeletonKind;rows:number}) {
  const accounts=kind==="admin-users"||kind==="admin-couriers";
  return <><PageHeading/><Shape className="loading-input loading-code-action"/><AdminStats/><div className="segmented admin-tabs loading-admin-tabs">{[0,1,2,3].map(index=><Shape key={index} className="loading-admin-tab"/>)}</div><div className="admin-toolbar"><Search/>{accounts&&<Shape className="loading-admin-add"/>}</div>{kind==="admin"?<><Filters count={statusDefinitions.length+1}/><AdminOrders rows={rows}/></>:accounts?<AdminAccounts rows={rows} couriers={kind==="admin-couriers"}/>:<><AdminCollectionAccounts/><StaffInvoices rows={rows}/></>}</>;
}
function EmployeeOrders({rows}: {rows:number}) { return <div className="employee-order-list">{Array.from({length:rows},(_,index)=><div className="employee-order-card loading-employee-order" key={index}><Shape className="employee-order-card__icon loading-square"/><div className="loading-lines"><Line size="title"/><Line/><Line/><div className="employee-order-card__contacts"><Line size="short"/><Line size="short"/></div></div><Shape className="loading-badge"/><Shape className="loading-button"/></div>)}</div>; }
function EmployeeLayout({rows}: {rows:number}) { return <><PageHeading/><div className="employee-scan-card loading-staff-scan"><Shape className="employee-scan-card__icon"/><div className="employee-scan-card__copy"><Line size="short"/><Line size="heading"/><Line/><Line/></div><Shape className="employee-scan-card__button"/><div className="employee-scan-card__rule"><Line/></div></div><div className="staff-quick-actions"><Shape className="loading-input"/><Shape className="loading-input"/></div><section className="employee-collections loading-staff-section"><header><Lines/><Shape className="loading-badge"/></header><StaffInvoices rows={2} employee/></section><div className="employee-permissions">{[0,1,2,3].map(index=><article key={index}><Shape className="loading-square"/><Lines/></article>)}</div><div className="employee-stats">{[0,1,2].map(index=><article key={index}><Line size="short"/><Line size="amount"/></article>)}</div><section className="employee-orders loading-staff-section"><header><Lines/><Shape className="loading-badge"/></header><Filters count={2}/><EmployeeOrders rows={rows}/></section></>; }
function FollowupDetailLayout({staff=false}: {staff?:boolean}) {
  return <><div className="followup-detail-actions"><Shape className="loading-button"/><Shape className="loading-button"/></div>
    <div className="followup-summary loading-followup-summary"><div className="loading-followup-copy"><Shape className="loading-badge"/><Line size="heading"/><Line size="short"/><Lines/></div><div className="loading-followup-facts">{[0,1,2,3].map(index=><div key={index}><Line size="short"/><Line size="title"/></div>)}</div></div>
    <Panel className="loading-followup-extra"><Line size="title"/><Pair><Line size="short"/><Line size="short"/></Pair></Panel><Shape className="loading-button"/>
    <div className="loading-followup-conversation"><Pair><Line size="title"/><Shape className="loading-button"/></Pair><Content kind="conversation" rows={2}/><Pair><Shape className="loading-button"/><Shape className="loading-button"/></Pair></div>
    {staff&&<Panel className="loading-staff-response"><Line size="title"/><Fields count={1}/><Line size="short"/><Shape className="loading-response"/><Shape className="loading-button"/></Panel>}</>;
}

function Content({kind,rows}: {kind:SkeletonKind;rows:number}) {
  switch(kind) {
    case "dashboard": return <Dashboard />;
    case "admin": case "admin-users": case "admin-couriers": case "admin-collections": return <AdminLayout kind={kind} rows={rows}/>;
    case "employee": return <EmployeeLayout rows={rows}/>;
    case "staff-parcels": return <><Search/><Filters/><ParcelRows rows={rows}/></>;
    case "parcels": return <><Search/><Filters/><ParcelRows rows={rows}/></>;
    case "returns": return <><Panel><Lines/></Panel><Metrics/><Filters/><ParcelRows rows={rows}/></>;
    case "collections": return <><Panel className="loading-collection-summary"><Line size="short"/><Line size="amount"/><Shape className="loading-button"/></Panel><div className="loading-collection-metrics">{[0,1,2].map(index=><Panel key={index}><Shape className="loading-square"/><Line size="title"/><Line size="short"/></Panel>)}</div><InvoiceRows rows={rows}/></>;
    case "invoice": return <><Panel><Pair><Line size="heading"/><Shape className="loading-badge"/></Pair><Line size="short"/><Line size="amount"/><div className="loading-counts"><Lines/><Lines/></div><Shape className="loading-button"/></Panel><ParcelRows rows={2}/></>;
    case "order": return <><Panel><Pair><Line size="heading"/><Shape className="loading-badge"/></Pair><Shape className="loading-qr"/><Fields count={4}/></Panel><Metrics/><Panel><Line size="title"/><Timeline/></Panel></>;
    case "followups": return <FollowupRows rows={rows}/>;
    case "followup-detail": return <FollowupDetailLayout/>;
    case "staff-followup-detail": return <FollowupDetailLayout staff/>;
    case "customers": return <PersonRows rows={rows}/>;
    case "customer-detail": return <><Panel><Pair><Shape className="loading-avatar"/><Lines/></Pair><Metrics/></Panel><Filters/><FollowupRows rows={rows}/></>;
    case "recipients": return <><Search/><PersonRows rows={rows} recipient/></>;
    case "conversation": return <><div className="loading-messages">{Array.from({length:rows},(_,index) => <div key={index} className="loading-message"><Pair><Shape className="loading-avatar"/><Line size="short"/></Pair><Line/><Line size="title"/><Line size="short"/></div>)}</div><Shape className="loading-response"/></>;
    case "devices": return <div className="loading-rows">{Array.from({length:rows},(_,index)=><Panel key={index}><Pair><Shape className="loading-device"/><Lines/><Shape className="loading-badge"/></Pair><div className="loading-counts"><Lines/><Lines/></div><Shape className="loading-button"/></Panel>)}</div>;
    case "notifications": return <div className="loading-rows">{Array.from({length:rows},(_,index)=><Panel key={index}><Pair><Shape className="loading-avatar"/><Lines/><Shape className="loading-dot"/></Pair></Panel>)}</div>;
    case "settings": return <><SettingRows rows={4}/><SettingRows rows={2}/><Panel><Line size="title"/><div className="loading-rating">{[0,1,2,3,4].map(index=><Shape className="loading-square loading-square--small" key={index}/>)}</div></Panel><SettingRows rows={1}/><Line size="short"/></>;
    case "profile": return <><Panel><div className="loading-profile"><Shape className="loading-avatar loading-avatar--large"/><Line size="title"/><Line size="short"/></div></Panel><Fields count={6}/><Shape className="loading-button"/></>;
    case "form": return <><Panel><Line size="title"/><Fields count={4}/></Panel><Panel><Line size="title"/><Fields count={4}/><Shape className="loading-response"/></Panel><Metrics/><Shape className="loading-button"/></>;
    case "security": return <><SettingRows rows={3}/><Panel><Lines/><Shape className="loading-button"/></Panel></>;
    case "password": return <Panel><Lines/><Fields count={3}/><Shape className="loading-button"/></Panel>;
    case "preferences": return <><SettingRows rows={3} switches/><Panel><Line size="title"/><Filters/></Panel></>;
    case "help": return <><Panel><Line size="heading"/><Lines/><Shape className="loading-button"/></Panel><SettingRows rows={4}/></>;
    case "privacy": return <>{[0,1,2].map(index=><Panel key={index}><Line size="title"/><Lines/><Lines/></Panel>)}</>;
    case "codes": return <><Panel><Fields count={2}/><Shape className="loading-button"/></Panel><div className="loading-code-grid">{[0,1,2,3].map(index=><Panel key={index}><Shape className="loading-qr"/><Line size="short"/></Panel>)}</div></>;
    case "deletion-requests": return <><Filters/>{Array.from({length:rows},(_,index)=><Panel key={index}><Pair><Shape className="loading-avatar"/><Lines/><Shape className="loading-badge"/></Pair><Lines/><Pair><Shape className="loading-button"/><Shape className="loading-button"/></Pair></Panel>)}</>;
    case "delete-account": return <><Panel><Lines/></Panel><Panel><Pair><Shape className="loading-square"/><Lines/></Pair><Timeline/></Panel><Shape className="loading-button"/></>;
    case "tracking": return <><Panel><Pair><Shape className="loading-square"/><Lines/><Shape className="loading-badge"/></Pair></Panel><Timeline/></>;
    case "attachment": return <Shape className="loading-attachment"/>;
    case "import": return <><Panel><Lines/><Shape className="loading-button"/></Panel><Shape className="loading-upload"/><Panel><Line size="title"/><Fields count={2}/></Panel></>;
  }
}

/** A placeholder follows the layout it replaces; existing content never becomes a skeleton on refresh. */
export function LoadingSkeleton({kind="followups",label="جارٍ تحميل البيانات…",rows=3,page=false}: {kind?:SkeletonKind;label?:string;rows?:number;page?:boolean}) {
  return <section className={`loading-skeleton loading-skeleton--${kind}`} role="status" aria-live="polite" aria-busy="true" aria-label={label}><span className="sr-only">{label}</span><div aria-hidden="true">{page && !["dashboard","employee","admin","admin-users","admin-couriers","admin-collections"].includes(kind) && <div className="loading-page-heading"><div className="loading-lines"><Line size="heading"/><Line size="short"/></div><Shape className="loading-button"/></div>}<Content kind={kind} rows={rows}/></div></section>;
}

/** Reads geometry only: this hint never restores data, permissions, or account state. */
export function readBootstrapKind(): SkeletonKind {
  try {
    const params=new URLSearchParams(window.location.search);
    if(params.get("notificationOrder")) return "order";
    if(params.get("openNotifications")==="1") return "notifications";
    const raw=JSON.parse(window.sessionStorage.getItem(NAVIGATION_STORAGE_KEY)??"null");
    if(!raw || raw.version!==1 || typeof raw.userId!=="string" || !raw.userId) return "dashboard";
    const staff=["admin","courier","employee"].includes(raw.role);
    const detail=raw.details && typeof raw.details==="object" ? raw.details : {};
    if(raw.view==="admin" || (raw.view==="home" && raw.role==="admin")) return detail.adminTab==="collections" ? "admin-collections" : detail.adminTab==="couriers" ? "admin-couriers" : detail.adminTab==="users" ? "admin-users" : "admin";
    if(raw.view==="home" && ["courier","employee"].includes(raw.role)) return "employee";
    if(["followups","customer-followups","order-detail"].includes(raw.view) && typeof detail.followupId==="string" && detail.followupId) return staff ? "staff-followup-detail" : "followup-detail";
    if(raw.view==="collections" && typeof detail.invoiceId==="string" && detail.invoiceId) return "invoice";
    if(raw.view==="customer-followups" && typeof detail.customerId==="string" && detail.customerId) return detail.customerTab==="parcels" ? "staff-parcels" : "customer-detail";
    if(raw.view==="shipments" && staff) return "staff-parcels";
    const kinds: Record<string,SkeletonKind>={home:"dashboard",admin:"admin",shipments:"parcels",returns:"returns",collections:"collections","parcel-codes":"codes","new-order":"form","order-detail":"order",followups:"followups","customer-followups":"customers",recipients:"recipients",settings:"settings",security:"security","change-password":"password","linked-devices":"devices","deletion-requests":"deletion-requests","delete-account":"delete-account","notification-settings":"preferences",preferences:"preferences",help:"help",privacy:"privacy",notifications:"notifications",trash:"parcels",import:"import",profile:"profile"};
    return Object.hasOwn(kinds,raw.view) ? kinds[raw.view] : "dashboard";
  } catch { return "dashboard"; }
}
