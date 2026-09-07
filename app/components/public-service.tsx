"use client";

import { useEffect, useState, type ReactNode } from "react";
import { deletionApi } from "./deletion-request";

export function PublicServiceLinks() {
  return <nav className="public-service-links" aria-label="الخصوصية والمساعدة"><a href="/privacy">سياسة الخصوصية</a><a href="/delete-account">طلب حذف الحساب</a><a href="/support">الدعم</a></nav>;
}

export function PublicServiceLayout({ title, children }: { title: string; children: ReactNode }) {
  return <main className="public-service-page" dir="rtl"><header><a href="/">المدينة إكسبرس</a><h1>{title}</h1></header>{children}<PublicServiceLinks /><p><a href="/">العودة إلى الموقع</a></p></main>;
}

export function SupportContacts() {
  const [contacts, setContacts] = useState<{ supportPhone: string; supportEmail: string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    deletionApi<{ supportPhone: string; supportEmail: string }>("public/config")
      .then((data) => { if (active) setContacts(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  return <div className="support-contacts">
    {contacts?.supportPhone && <p><a href={`tel:${contacts.supportPhone}`}>اتصل بالدعم: <bdi>{contacts.supportPhone}</bdi></a></p>}
    {contacts?.supportEmail && <p><a href={`mailto:${contacts.supportEmail}`}>راسل الدعم: <bdi>{contacts.supportEmail}</bdi></a></p>}
    {error ? <p role="alert">تعذّر تحميل بيانات التواصل. أعد فتح الصفحة للمحاولة.</p> : !contacts ? <p role="status">جارٍ تحميل بيانات التواصل…</p> : !contacts.supportPhone && !contacts.supportEmail && <p>لم تُحدّد بيانات التواصل بعد. يمكنك تقديم طلب حذف الحساب مباشرةً من الرابط أدناه.</p>}
    <a href="/delete-account">تقديم طلب حذف الحساب ومتابعته</a>
  </div>;
}
