import { PublicServiceLayout, SupportContacts } from "../components/public-service";
import { deletionPolicy } from "../lib/account-deletion";
import { LEGAL_DOCUMENT_VERSION, privacyPolicySections, termsOfUseSections, applicationPermissionDisclosures } from "../lib/legal";

export default function PublicPrivacyPage() {
  return <PublicServiceLayout title="الخصوصية وشروط الخدمة"><p>المدينة إكسبرس · نسخة {LEGAL_DOCUMENT_VERSION}</p>
    <section><h2>سياسة الخصوصية</h2>{privacyPolicySections.map((entry) => <article key={entry.title}><h3>{entry.title}</h3><p>{entry.body}</p></article>)}</section>
    <section><h2>حذف الحساب والاحتفاظ بالبيانات</h2><p>{deletionPolicy.reviewTimeline}</p><p>{deletionPolicy.retentionNotice}</p><a href="/delete-account">تقديم طلب حذف الحساب عبر الموقع</a></section>
    <section><h2>الأذونات في الموقع</h2>{applicationPermissionDisclosures.map((entry) => <article key={entry.id}><h3>{entry.title}</h3><p>{entry.body}</p></article>)}<p>يشرح كل تطبيق أذوناته ووسائل الحماية المتاحة له في إعدادات الخصوصية داخله.</p></section>
    <section><h2>شروط الخدمة</h2>{termsOfUseSections.map((entry) => <article key={entry.title}><h3>{entry.title}</h3><p>{entry.body}</p></article>)}</section>
    <section><h2>التواصل بشأن بياناتك</h2><SupportContacts /></section>
  </PublicServiceLayout>;
}
