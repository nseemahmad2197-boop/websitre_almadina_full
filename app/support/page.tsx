import { PublicServiceLayout, SupportContacts } from "../components/public-service";

export default function PublicSupportPage() {
  return <PublicServiceLayout title="دعم المدينة إكسبرس"><section><h2>كيف نساعدك؟</h2><p>للمساعدة في الحساب أو الطرود أو التحصيلات، استخدم وسيلة التواصل المعلنة للشركة.</p><SupportContacts /></section><section><h2>طلبات حذف الحساب</h2><p>لا يلزم الاتصال بالدعم لتقديم طلب الحذف. سجّل الطلب من صفحة الحذف واحفظ رابط المتابعة؛ تظهر فيه حالة الطلب وموعد المراجعة وإجراءات التسوية.</p><a href="/delete-account">تقديم الطلب أو متابعة حالته</a></section></PublicServiceLayout>;
}
