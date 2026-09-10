package com.almadinaexpress.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed

private data class HelpFaq(val question: String, val answer: String)

private val helpFaqs = listOf(
    HelpFaq(
        "ما هي خدمة المدينة إكسبرس؟",
        "المدينة إكسبرس شركة توصيل فلسطينية توفر حلول شحن آمنة وسريعة للمتاجر الإلكترونية والأفراد داخل جميع المحافظات، مع خدمة الدفع عند الاستلام وتحديثات مباشرة لحالة الطرد.",
    ),
    HelpFaq(
        "كيف أبدأ التعامل مع المدينة إكسبرس؟",
        "أنشئ حسابًا باسم متجرك ورقم جوالك، ثم أضف أول طرد. سيتولى مندوبنا استلام الطرد وتوصيله إلى العميل.",
    ),
    HelpFaq(
        "أين تقع فروعكم؟",
        "نعمل من خلال شبكة مندوبين تغطي الخليل وبيت لحم ورام الله والقدس ونابلس وجنين وطولكرم وقلقيلية وسلفيت وأريحا وطوباس.",
    ),
    HelpFaq(
        "كيف أضيف طردًا جديدًا؟",
        "اضغط على زر + أسفل الشاشة، أدخل بيانات المستلم والعنوان وقيمة الطرد، ثم اضغط إنشاء الطرد.",
    ),
    HelpFaq(
        "متى يصل الطرد للعميل؟",
        "عادة تصل الطرود داخل المحافظة في اليوم نفسه، وبين المحافظات خلال يوم إلى يومي عمل حسب المنطقة.",
    ),
    HelpFaq(
        "كيف أستلم المبالغ المحصلة؟",
        "تُجمع مبالغ الدفع عند الاستلام وتُضاف إلى رصيد متجرك، ثم تُحوّل بحسب جدول التحويل المتفق عليه.",
    ),
    HelpFaq(
        "كيف أستلم مبالغ التحصيل؟",
        "أنشئ فاتورة من تبويب التحصيلات بعد وصول الطرود. عندما تصبح جاهزة، اعرض رمز التحقق للموظف؛ وبعد قراءة الرمز الصحيح تتغير حالة التحصيل مباشرة إلى «تم التسليم».",
    ),
)

@Composable
fun LegalScreen(onBack: () -> Unit) {
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { ScreenHeader("الشروط والخصوصية والأذونات", "نسخة $LEGAL_VERSION", onBack) }
        item {
            SectionCard(title = "شروط الاستخدام") {
                termsSummary.forEachIndexed { index, entry ->
                    Text("${index + 1}. ${entry.first}", fontWeight = FontWeight.Bold)
                    Text(entry.second, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        item {
            SectionCard(title = "سياسة الخصوصية") {
                privacySummary.forEachIndexed { index, entry ->
                    Text("${index + 1}. ${entry.first}", fontWeight = FontWeight.Bold)
                    Text(entry.second, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        item {
            SectionCard(title = "الأذونات") {
                Text(
                    "الإشعارات اختيارية. الكاميرا تُفتح عبر ماسح Google Code Scanner فقط عند طلبك ولا يحتفظ التطبيق بصورة أو فيديو. ويمكن إدخال الأكواد يدويًا.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text("يجب أن يكون الطرد مطابقًا للوصف المكتوب.", fontWeight = FontWeight.Bold)
            }
        }
        item { SectionCard(title = "الروابط الرسمية") { PublicPolicyLinks(); PublicWebsiteLink("التواصل مع الدعم", "/support") } }
        item { Spacer(Modifier.height(80.dp)) }
    }
}

@Composable
fun HelpCenterScreen(onBack: () -> Unit) {
    var expandedIndex by rememberSaveable { mutableIntStateOf(0) }
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { ScreenHeader("مركز المساعدة", "إجابات عن أكثر الأسئلة شيوعًا", onBack) }
        item {
            SectionCard {
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.HelpOutline,
                        null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Text("كيف نقدر نساعدك؟", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text(
                        "تصفح الأسئلة الشائعة أو افتح صفحة التواصل الرسمية للشركة.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    PublicWebsiteLink("التواصل مع الدعم", "/support")
                }
            }
        }
        itemsIndexed(helpFaqs, key = { _, faq -> faq.question }) { index, faq ->
            val expanded = expandedIndex == index
            Card(
                modifier = Modifier.fillMaxWidth().clickable {
                    expandedIndex = if (expanded) -1 else index
                },
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .38f)),
            ) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                            if (expanded) "إخفاء الإجابة" else "عرض الإجابة",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Text(faq.question, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                        Icon(Icons.AutoMirrored.Outlined.HelpOutline, null, tint = MaterialTheme.colorScheme.primary)
                    }
                    if (expanded) {
                        Text(
                            faq.answer,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        item { Spacer(Modifier.height(80.dp)) }
    }
}
