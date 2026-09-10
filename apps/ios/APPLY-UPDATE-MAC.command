#!/bin/bash
set -euo pipefail

update_source="$(cd -- "$(dirname -- "$0")" && pwd)"
if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "شغّل هذا الملف على جهاز Mac الذي تستخدمه مع Xcode."
    exit 1
fi

on_exit() {
    local result=$?
    if [[ $result -ne 0 ]]; then
        echo "لم يكتمل التحديث. راجع الرسالة أعلاه؛ لا تشغّل النسخة القديمة على أنها محدّثة."
        read -r -p "اضغط Return لإغلاق النافذة… " _ || true
    fi
}
trap on_exit EXIT

echo "تحديث المدينة إكسبرس 1.0.12 — أغلق Xcode بعد حفظ عملك قبل اختيار المجلد."
if ! selected_project="$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "اختر مجلد مشروع الآيفون الحالي الذي يحتوي على AlmadinaExpress.xcodeproj، بعد إغلاق Xcode")')"; then
    echo "أُلغي اختيار المجلد. لم تتغير الملفات."
    exit 0
fi

python3 "$update_source/scripts/apply-update.py" "$selected_project"
/usr/bin/open -a Xcode "${selected_project%/}/AlmadinaExpress.xcodeproj"
echo "اختر الآيفون في Xcode واضغط Run، ثم تحقق من رقم الإصدار والبناء في إعدادات التطبيق."
read -r -p "اضغط Return لإغلاق هذه النافذة… " _ || true
