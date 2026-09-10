package com.almadinaexpress.app

import android.app.Application
import com.almadinaexpress.app.notifications.NotificationHelper
import com.almadinaexpress.app.notifications.NotificationSyncWorker

class AlmadinaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)
        NotificationSyncWorker.schedule(this)
    }

    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            runCatching { cacheDir.resolve("network-v2").listFiles()?.filter { it.name.endsWith(".tmp") }?.forEach { it.delete() } }
        }
    }
}
