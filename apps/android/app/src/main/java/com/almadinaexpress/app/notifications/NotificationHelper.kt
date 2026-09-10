package com.almadinaexpress.app.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.almadinaexpress.app.MainActivity
import com.almadinaexpress.app.R
import com.almadinaexpress.app.data.NoticeItem
import com.almadinaexpress.app.security.SecureStore

object NotificationHelper {
    private const val CHANNEL_SOUND_ID = "almadina_updates_sound_v3"
    private const val CHANNEL_SILENT_ID = "almadina_updates_silent_v3"

    fun notificationsAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val sounds = SecureStore(context).get(SecureStore.KEY_SOUNDS) != "false"
            val channel = context.getSystemService(NotificationManager::class.java)
                .getNotificationChannel(if (sounds) CHANNEL_SOUND_ID else CHANNEL_SILENT_ID)
            if (channel?.importance == NotificationManager.IMPORTANCE_NONE) return false
        }
        return true
    }

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val soundChannel = NotificationChannel(
            CHANNEL_SOUND_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.notification_channel_description)
            enableVibration(true)
            setSound(sound, audio)
        }
        val silentChannel = NotificationChannel(
            CHANNEL_SILENT_ID,
            "${context.getString(R.string.notification_channel_name)} — صامت",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_description)
            enableVibration(false)
            setSound(null, null)
        }
        context.getSystemService(NotificationManager::class.java).apply {
            createNotificationChannel(soundChannel)
            createNotificationChannel(silentChannel)
        }
    }

    fun recordAndNotify(context: Context, notices: List<NoticeItem>) {
        val store = SecureStore(context)
        val previousValue = store.get(SecureStore.KEY_KNOWN_NOTICES)
        val previous = previousValue?.lineSequence()?.filter { it.isNotBlank() }?.toSet().orEmpty()
        val latestIds = notices.take(500).map { it.id }
        if (previousValue == null) {
            store.put(SecureStore.KEY_KNOWN_NOTICES, latestIds.joinToString("\n"))
            return
        }
        if (store.get(SecureStore.KEY_NOTIFICATIONS) == "false") {
            store.put(SecureStore.KEY_KNOWN_NOTICES, latestIds.joinToString("\n"))
            return
        }
        notices.asReversed()
            .filter { !it.read && it.id !in previous }
            .takeLast(4)
            .forEach { show(context, it) }
        store.put(SecureStore.KEY_KNOWN_NOTICES, latestIds.joinToString("\n"))
    }

    fun showTest(context: Context) {
        show(
            context,
            NoticeItem(
                id = "test-${System.currentTimeMillis()}",
                userId = "local",
                title = "اختبار إشعارات المدينة إكسبرس",
                message = "إذا سمعت الصوت وظهر هذا التنبيه فإشعارات التطبيق تعمل.",
                read = false,
                createdAt = java.time.Instant.now().toString(),
                orderId = null,
                raw = kotlinx.serialization.json.JsonObject(emptyMap()),
            ),
        )
    }

    private fun show(context: Context, notice: NoticeItem) {
        if (!notificationsAllowed(context)) return
        val sounds = SecureStore(context).get(SecureStore.KEY_SOUNDS) != "false"
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            notice.orderId?.let { putExtra(MainActivity.EXTRA_ORDER_ID, it) }
        }
        val pending = PendingIntent.getActivity(
            context,
            notice.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val channelId = if (sounds) CHANNEL_SOUND_ID else CHANNEL_SILENT_ID
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(notice.title)
            .setContentText(notice.message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notice.message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(pending)
            .setColor(0xFF087C45.toInt())
            .setDefaults(if (sounds) NotificationCompat.DEFAULT_ALL else 0)
            .setSilent(!sounds)
            .build()
        // Keep this check at the call site: Lint cannot infer the permission
        // guarantee from notificationsAllowed(), and permission can be revoked.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        try {
            NotificationManagerCompat.from(context).notify(notice.id.hashCode(), notification)
        } catch (_: SecurityException) {
            // The user may revoke permission between the check and notify().
            // Skip this notification; keep the in-app notice and sync working.
        }
    }
}
