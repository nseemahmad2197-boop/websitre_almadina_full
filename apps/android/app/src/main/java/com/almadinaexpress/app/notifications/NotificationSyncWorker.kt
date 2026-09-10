package com.almadinaexpress.app.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.almadinaexpress.app.data.AppRepository
import com.almadinaexpress.app.data.applyTrashRetention
import com.almadinaexpress.app.network.ApiException
import com.almadinaexpress.app.security.SessionBoundary
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

class NotificationSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result = try {
        val epoch = SessionBoundary.current()
        val repository = AppRepository(applicationContext)
        val current = repository.session()
        val retention = applyTrashRetention(current.database)
        SessionBoundary.withCurrent(epoch) { Unit }
        val snapshot = if (retention.changed) repository.saveDatabase(current, retention.database) else current
        SessionBoundary.withCurrent(epoch) { NotificationHelper.recordAndNotify(applicationContext, snapshot.notices) }
        Result.success()
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        if (error is ApiException && error.status == 401) Result.success() else Result.retry()
    }

    companion object {
        private const val WORK_NAME = "almadina-native-notification-sync"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = PeriodicWorkRequestBuilder<NotificationSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
