import { DeletionRequestPanel } from "../components/deletion-request";
import { PublicServiceLayout } from "../components/public-service";

export default function PublicDeletionPage() {
  return <PublicServiceLayout title="حذف حساب المدينة إكسبرس"><p>قدّم طلب حذف حسابك وبياناته دون الحاجة إلى تثبيت التطبيق. نتحقق من ملكية الحساب بكلمة المرور، ويمكن تقديم الطلب حتى مع وجود طرود نشطة أو مبالغ مستحقة.</p><DeletionRequestPanel publicPage /><p>نسيت كلمة المرور؟ <a href="/">افتح صفحة الدخول واختر «نسيت كلمة المرور»</a> ثم عُد لتقديم طلبك.</p></PublicServiceLayout>;
}
