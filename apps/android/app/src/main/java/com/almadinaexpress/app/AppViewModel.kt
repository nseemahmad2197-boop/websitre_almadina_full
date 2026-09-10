package com.almadinaexpress.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.almadinaexpress.app.data.AppRepository
import com.almadinaexpress.app.data.AccountDeletionInfo
import com.almadinaexpress.app.data.AvailableAccount
import com.almadinaexpress.app.data.CollectionItem
import com.almadinaexpress.app.data.Membership
import com.almadinaexpress.app.data.NewOrderInput
import com.almadinaexpress.app.data.ParcelCodeBatch
import com.almadinaexpress.app.data.isValidParcelCode
import com.almadinaexpress.app.data.normalizeParcelCode
import com.almadinaexpress.app.data.NoticeItem
import com.almadinaexpress.app.data.OrderItem
import com.almadinaexpress.app.data.OrderStatus
import com.almadinaexpress.app.data.RegistrationInput
import com.almadinaexpress.app.data.Role
import com.almadinaexpress.app.data.SessionSnapshot
import com.almadinaexpress.app.data.UserItem
import com.almadinaexpress.app.data.array
import com.almadinaexpress.app.data.bool
import com.almadinaexpress.app.data.buildNewOrder
import com.almadinaexpress.app.data.deliveryZoneFrom
import com.almadinaexpress.app.data.integer
import com.almadinaexpress.app.data.isOrderInvoicedForCurrentShipment
import com.almadinaexpress.app.data.newId
import com.almadinaexpress.app.data.newTrackingEvent
import com.almadinaexpress.app.data.number
import com.almadinaexpress.app.data.returnDeliveryFee
import com.almadinaexpress.app.data.applyTrashRetention
import com.almadinaexpress.app.data.string
import com.almadinaexpress.app.data.text
import com.almadinaexpress.app.data.updated
import com.almadinaexpress.app.data.withArray
import com.almadinaexpress.app.data.withObject
import com.almadinaexpress.app.network.ApiException
import com.almadinaexpress.app.notifications.NotificationHelper
import com.almadinaexpress.app.security.SecureStore
import com.almadinaexpress.app.security.SessionBoundary
import com.almadinaexpress.app.security.acceptsSnapshot
import javax.crypto.Cipher
import kotlinx.coroutines.CancellationException
import com.almadinaexpress.app.ui.theme.THEME_LIGHT
import com.almadinaexpress.app.ui.theme.normalizeThemePreference
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.security.SecureRandom
import java.util.UUID

data class MainUiState(
    val snapshot: SessionSnapshot? = null,
    val booting: Boolean = true,
    val busy: Boolean = false,
    val offlineCache: Boolean = false,
    val message: String? = null,
    val messageError: Boolean = false,
    val registrationEmail: String? = null,
    val passwordResetStep: String? = null,
    val publicTracking: JsonObject? = null,
    val theme: String = THEME_LIGHT,
    val sounds: Boolean = true,
    val notifications: Boolean = true,
    val notificationPermissionGranted: Boolean = false,
    val biometricLoginAvailable: Boolean = false,
    val biometricAccountEmail: String? = null,
    val availableAccounts: List<AvailableAccount> = emptyList(),
    val parcelCodePendingCount: Int? = null,
    val parcelCodePendingLabel: String? = null,
    val accountDeletion: AccountDeletionInfo? = null,
    val accountDeletionLoading: Boolean = false,
    val accountDeletionError: String? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = AppRepository(application)
    private val _state = MutableStateFlow(
        MainUiState(
            theme = normalizeThemePreference(repository.getPreference(SecureStore.KEY_THEME, THEME_LIGHT)),
            sounds = repository.getPreference(SecureStore.KEY_SOUNDS, "true") == "true",
            notifications = repository.getPreference(SecureStore.KEY_NOTIFICATIONS, "true") == "true",
            notificationPermissionGranted = NotificationHelper.notificationsAllowed(application),
            biometricLoginAvailable = repository.biometricLoginAvailable(),
            biometricAccountEmail = repository.biometricAccountEmail(),
            availableAccounts = repository.availableAccounts(),
        ),
    )
    val state: StateFlow<MainUiState> = _state.asStateFlow()
    private var pollingJob: Job? = null
    private var refreshJob: Job? = null
    private var refreshing = false
    private var foreground = true
    val sessionGeneration: Long get() = SessionBoundary.current()

    fun prepareBiometricCipher(): Cipher = repository.prepareBiometricCipher(enrolling = _state.value.snapshot != null)

    fun foregroundChanged(active: Boolean) {
        foreground = active
        if (active) { startPolling(); refresh(silent = true) }
        else { pollingJob?.cancel(); refreshJob?.cancel() }
    }
    private data class PendingParcelCodeRequest(val ownerId: String, val requestId: String, val count: Int, val label: String)
    private var pendingParcelCodeRequest: PendingParcelCodeRequest? = null
    private var parcelCodeGenerationInFlight = false

    init {
        restoreSession()
    }

    fun restoreSession() {
        repository.cachedSnapshot()?.let {
            _state.value = _state.value.copy(snapshot = it, booting = false, offlineCache = true)
        }
        viewModelScope.launch {
            runCatching { maintainTrash(repository.session()) }
                .onSuccess { acceptSnapshot(it, false); startPolling() }
                .onFailure { error ->
                    if (error is CancellationException) return@onFailure
                    if (error is ApiException && error.status == 401) {
                        repository.clearLocalSession()
                        _state.value = _state.value.copy(snapshot = null, booting = false, offlineCache = false)
                    } else {
                        _state.value = _state.value.copy(
                            booting = false,
                            offlineCache = _state.value.snapshot != null,
                            message = if (_state.value.snapshot == null) readable(error) else "تعذرت المزامنة؛ تظهر آخر بيانات محفوظة.",
                            messageError = true,
                        )
                    }
                }
        }
    }

    fun login(email: String, password: String) = launchBusy {
        require(email.isNotBlank() && password.isNotBlank()) { "أدخل البريد الإلكتروني وكلمة المرور." }
        val snapshot = maintainTrash(repository.login(email, password))
        acceptSnapshot(snapshot, replacingAccount = true)
        startPolling()
        showMessage("تم تسجيل الدخول بنجاح.")
    }

    fun loginWithBiometrics(cipher: Cipher) = launchBusy {
        val snapshot = try {
            repository.loginWithBiometrics(cipher)
        } catch (error: ApiException) {
            if (error.status == 401) {
                repository.disableBiometricLogin()
                _state.value = _state.value.copy(
                    biometricLoginAvailable = false,
                    biometricAccountEmail = null,
                )
                throw IllegalArgumentException("تغيّرت بيانات الحساب. سجّل الدخول بكلمة المرور ثم فعّل البصمة مجددًا.")
            }
            throw error
        }
        acceptSnapshot(maintainTrash(snapshot), replacingAccount = true)
        startPolling()
        showMessage("تم تسجيل الدخول بالبصمة بنجاح.")
    }

    fun enableBiometricLogin(password: String, cipher: Cipher, onDone: () -> Unit = {}) = launchBusy {
        val user = _state.value.snapshot?.currentUser ?: error("يجب تسجيل الدخول أولًا.")
        require(password.isNotBlank()) { "أدخل كلمة المرور الحالية لتفعيل البصمة." }
        val snapshot = maintainTrash(repository.enableBiometricLogin(user.email, password, cipher))
        acceptSnapshot(snapshot)
        _state.value = _state.value.copy(
            biometricLoginAvailable = true,
            biometricAccountEmail = user.email,
        )
        showMessage("تم تفعيل الدخول ببصمة الإصبع أو الوجه على هذا الجهاز.")
        onDone()
    }

    fun disableBiometricLogin() {
        repository.disableBiometricLogin()
        _state.value = _state.value.copy(
            biometricLoginAvailable = false,
            biometricAccountEmail = null,
            message = "تم إيقاف الدخول بالبصمة على هذا الجهاز.",
            messageError = false,
        )
    }

    fun reportBiometricError(message: String) {
        _state.value = _state.value.copy(message = message, messageError = true)
    }

    fun logout() = launchBusy {
        pollingJob?.cancel()
        refreshJob?.cancel()
        repository.logout()
        _state.value = _state.value.copy(snapshot = null, offlineCache = false, publicTracking = null, accountDeletion = null, accountDeletionError = null, accountDeletionLoading = false, message = "تم تسجيل الخروج.")
    }

    fun refresh(silent: Boolean = false) {
        if (_state.value.snapshot == null || _state.value.busy || refreshing) return
        refreshing = true
        val epoch = SessionBoundary.current()
        if (!silent) _state.value = _state.value.copy(busy = true)
        refreshJob = viewModelScope.launch {
            try {
                val next = maintainTrash(repository.session())
                SessionBoundary.withCurrent(epoch) { acceptSnapshot(next) }
            } catch (_: CancellationException) {
                // A backgrounded screen or an old account cannot change UI state.
            } catch (error: Exception) {
                if (epoch == SessionBoundary.current() && (!silent || (error is ApiException && error.status == 401))) fail(error)
            } finally {
                refreshing = false
                if (!silent) _state.value = _state.value.copy(busy = false)
            }
        }
    }

    fun requestRegistration(input: RegistrationInput) = launchBusy {
        validateRegistration(input)
        repository.requestRegistration(input)
        _state.value = _state.value.copy(registrationEmail = input.email.trim(), message = "أرسلنا رمز التحقق إلى بريدك.", messageError = false)
    }

    fun verifyRegistration(code: String) = launchBusy {
        require(Regex("^[0-9٠-٩]{6}$").matches(code)) { "أدخل رمز التحقق المكوّن من 6 أرقام." }
        acceptSnapshot(maintainTrash(repository.verifyRegistration(normalizeDigits(code))), replacingAccount = true)
        _state.value = _state.value.copy(registrationEmail = null)
        startPolling()
        showMessage("تم إنشاء الحساب وتسجيل الدخول.")
    }

    fun cancelRegistrationCode() {
        _state.value = _state.value.copy(registrationEmail = null)
    }

    fun beginPasswordReset() {
        _state.value = _state.value.copy(passwordResetStep = "request", message = null)
    }

    fun cancelPasswordReset() {
        _state.value = _state.value.copy(passwordResetStep = null)
    }

    fun requestPasswordReset(identifier: String) = launchBusy {
        require(android.util.Patterns.EMAIL_ADDRESS.matcher(identifier.trim()).matches()) { "أدخل البريد الإلكتروني المسجّل." }
        repository.requestPasswordReset(identifier)
        _state.value = _state.value.copy(passwordResetStep = "verify")
        showMessage("إذا كان البريد مطابقًا لحساب مسجّل فسيصل رمز التحقق.")
    }

    fun verifyPasswordReset(code: String) = launchBusy {
        val normalized = normalizeDigits(code)
        require(Regex("^[0-9]{6}$").matches(normalized)) { "أدخل رمز التحقق المكوّن من 6 أرقام." }
        repository.verifyPasswordReset(normalized)
        _state.value = _state.value.copy(passwordResetStep = "complete")
        showMessage("تم التحقق من الرمز. أنشئ كلمة المرور الجديدة.")
    }

    fun completePasswordReset(password: String, confirm: String) = launchBusy {
        require(password == confirm) { "تأكيد كلمة المرور غير مطابق." }
        require(password.length >= 8 && password.any(Char::isLetter) && password.any(Char::isDigit) && password.any { !it.isLetterOrDigit() }) {
            "كلمة المرور يجب أن تحتوي على حرف ورقم ورمز."
        }
        repository.completePasswordReset(password)
        repository.disableBiometricLogin()
        repository.clearLocalSession()
        _state.value = _state.value.copy(
            passwordResetStep = null,
            biometricLoginAvailable = false,
            biometricAccountEmail = null,
        )
        showMessage("تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.")
    }

    fun publicTrack(tracking: String) = launchBusy {
        require(Regex("^ALX-[0-9]{6,20}$", RegexOption.IGNORE_CASE).matches(tracking.trim())) { "أدخل رقم تتبع صحيحًا مثل ALX-20200008." }
        _state.value = _state.value.copy(publicTracking = repository.publicTrack(tracking))
    }

    fun clearPublicTracking() {
        _state.value = _state.value.copy(publicTracking = null)
    }

    fun createOrder(input: NewOrderInput, orderId: String, onDone: (String) -> Unit) = launchBusy {
        val snapshot = _state.value.snapshot ?: error("يجب تسجيل الدخول أولًا.")
        val user = snapshot.currentUser ?: error("الحساب غير متاح.")
        require(user.role == Role.MERCHANT) { "إنشاء الطرود متاح لحساب المستخدم." }
        require(input.recipientName.isNotBlank() && Regex("^05[0-9]{8}$").matches(input.recipientPhone)) { "تحقق من اسم المستلم ورقم الجوال." }
        require(input.governorate.isNotBlank() && input.city.isNotBlank() && input.address.isNotBlank()) { "اختر نطاق التوصيل وأدخل المنطقة والعنوان." }
        require(input.amount >= 0) { "قيمة الطرد غير صالحة." }
        val confirmed = repository.createOrder(buildNewOrder(user, input, orderId))
        require(confirmed.orders.any { it.id == orderId && it.merchantId == user.id }) { "لم يصل تأكيد إنشاء الطرد. أعد المحاولة." }
        acceptSnapshot(confirmed)
        showMessage("تم إنشاء الطرد. امسح كود QR من صفحة التفاصيل.")
        onDone(orderId)
    }

    fun assignParcelCode(orderId: String, trackingNumber: String, onDone: () -> Unit = {}) = launchBusy {
        val snapshot = _state.value.snapshot ?: error("يجب تسجيل الدخول أولًا.")
        val user = snapshot.currentUser ?: error("الحساب غير متاح.")
        val order = snapshot.orders.firstOrNull { it.id == orderId } ?: error("الطرد غير موجود.")
        require(user.role == Role.ADMIN || (user.role == Role.MERCHANT && order.merchantId == user.id)) { "إضافة كود QR متاحة لصاحب الطرد أو المسؤول فقط." }
        require(!order.deleted) { "استعد الطرد من المحذوفات قبل إضافة كود QR." }
        val code = normalizeParcelCode(trackingNumber)
        require(isValidParcelCode(code)) { "امسح رمز QR المطبوع على ملصق الشركة." }
        require(order.trackingNumber.isBlank() || normalizeParcelCode(order.trackingNumber) == code) { "تم حفظ كود لهذا الطرد ولا يمكن استبداله." }
        require(snapshot.orders.none { it.id != orderId && normalizeParcelCode(it.trackingNumber) == code }) { "هذا الكود مستخدم لطرد آخر. امسح ملصقًا غير مستخدم." }
        val confirmed = repository.assignParcelCode(orderId, code)
        require(confirmed.orders.any { it.id == orderId && it.trackingNumber == code }) { "لم يصل تأكيد حفظ الكود. أعد المحاولة بالكود نفسه." }
        acceptSnapshot(confirmed)
        showMessage("تمت قراءة QR وحفظ كود الطرد.")
        onDone()
    }

    fun createParcelCodeBatch(count: Int, label: String, onDone: (ParcelCodeBatch) -> Unit = {}) = launchBusy {
        if (parcelCodeGenerationInFlight) return@launchBusy
        val user = _state.value.snapshot?.currentUser ?: error("يجب تسجيل الدخول أولًا.")
        require(user.role == Role.ADMIN) { "حجز أكواد الطرود متاح للمسؤول فقط." }
        val pending = pendingParcelCodeRequest?.takeIf { it.ownerId == user.id } ?: restorePendingParcelCodeRequest(user.id) ?: run {
            require(count in 1..500) { "اختر عددًا من 1 إلى 500 كود." }
            PendingParcelCodeRequest(user.id, "parcel-codes-${UUID.randomUUID()}", count, label.trim().take(80))
        }
        pendingParcelCodeRequest = pending
        repository.setPreference("parcel-code-request-${user.id}", buildJsonObject {
            put("requestId", pending.requestId)
            put("count", pending.count)
            put("label", pending.label)
        }.toString())
        _state.value = _state.value.copy(parcelCodePendingCount = pending.count, parcelCodePendingLabel = pending.label)
        parcelCodeGenerationInFlight = true
        try {
            val result = repository.createParcelCodeBatch(pending.requestId, pending.count, pending.label)
            acceptSnapshot(result.snapshot)
            val batch = result.snapshot.parcelCodeBatches.first { it.id == result.batchId }
            pendingParcelCodeRequest = null
            repository.setPreference("parcel-code-request-${user.id}", "")
            _state.value = _state.value.copy(parcelCodePendingCount = null, parcelCodePendingLabel = null)
            showMessage("تم حجز ${batch.count} كود. يمكنك طباعتها الآن.")
            onDone(batch)
        } catch (error: Throwable) {
            // An uncertain response may already have committed. Keep this request ID for retry.
            if (error is ApiException && error.status in listOf(400, 403, 422)) {
                pendingParcelCodeRequest = null
                repository.setPreference("parcel-code-request-${user.id}", "")
                _state.value = _state.value.copy(parcelCodePendingCount = null, parcelCodePendingLabel = null)
            }
            throw error
        } finally {
            parcelCodeGenerationInFlight = false
        }
    }

    private fun restorePendingParcelCodeRequest(ownerId: String): PendingParcelCodeRequest? = runCatching {
        val raw = Json.parseToJsonElement(repository.getPreference("parcel-code-request-$ownerId", "")).jsonObject
        val requestId = raw.string("requestId")
        val count = raw.integer("count")
        if (requestId.isBlank() || count !in 1..500) null
        else PendingParcelCodeRequest(ownerId, requestId, count, raw.string("label"))
    }.getOrNull()

    fun prepareParcelCodePrint(batchId: String, unusedOnly: Boolean, onReady: (ParcelCodeBatch, List<String>) -> Unit) = launchBusy {
        require(_state.value.snapshot?.currentUser?.role == Role.ADMIN) { "طباعة الأكواد متاحة للمسؤول فقط." }
        // Refresh claims before opening print preview; cached/offline data must not allocate labels.
        val snapshot = repository.session()
        require(snapshot.currentUser?.role == Role.ADMIN) { "طباعة الأكواد متاحة للمسؤول فقط." }
        acceptSnapshot(snapshot)
        val batch = snapshot.parcelCodeBatches.firstOrNull { it.id == batchId } ?: error("دفعة الأكواد غير موجودة.")
        val codes = batch.codes.filter { !unusedOnly || it !in snapshot.claimedParcelCodes }
        require(codes.isNotEmpty()) { "جميع أكواد هذه الدفعة مستخدمة." }
        onReady(batch, codes)
    }

    fun addOrderNote(order: OrderItem, note: String, onDone: () -> Unit = {}) = mutateDatabase("تمت إضافة الملاحظة وإرسال الإشعار.", onDone) { snapshot ->
        require(note.trim().isNotEmpty()) { "اكتب نص الملاحظة." }
        val actor = snapshot.currentUser?.name ?: "فريق المدينة إكسبرس"
        val orders = snapshot.database.array("orders").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") != order.id) raw else {
                val events = raw.array("trackingEvents") + newTrackingEvent(order.status, actor, note.trim().take(500), "note")
                raw.updated("trackingEvents" to JsonArray(events), "updatedAt" to text(Instant.now().toString()))
            }
        }
        snapshot.database.withArray("orders", orders)
    }

    fun updateOrderStatus(order: OrderItem, status: OrderStatus, note: String, onDone: () -> Unit = {}) = mutateDatabase("تم تحديث حالة الطرد وإشعار المستخدم.", onDone) { snapshot ->
        require(snapshot.currentUser?.role == Role.ADMIN) { "تغيير الحالة الكامل متاح للمسؤول." }
        val actor = snapshot.currentUser?.name.orEmpty()
        val now = Instant.now().toString()
        val orders = snapshot.database.array("orders").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") != order.id) raw else raw.updated(
                "status" to text(status.apiValue),
                "trackingEvents" to JsonArray(raw.array("trackingEvents") + newTrackingEvent(status, actor, note.trim().take(500))),
                "updatedAt" to text(now),
            )
        }
        snapshot.database.withArray("orders", orders)
    }

    fun moveOrderToTrash(orderId: String, onDone: () -> Unit = {}) = mutateDatabase("تم نقل الطرد إلى المحذوفات.", onDone) { snapshot ->
        val order = snapshot.orders.firstOrNull { it.id == orderId }
        require(order != null && !order.deleted && snapshot.canTrash(order)) { "لا تملك صلاحية حذف هذا الطرد." }
        val now = Instant.now().toString()
        val orders = snapshot.database.array("orders").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") == orderId) raw.updated(
                "deleted" to bool(true),
                "deletedAt" to text(now),
                "updatedAt" to text(now),
            ) else raw
        }
        snapshot.database.withArray("orders", orders)
    }

    fun hideCollection(invoiceId: String, hidden: Boolean = true) = mutateDatabase(
        if (hidden) "تم حذف الفاتورة من قائمتك. يمكنك استعادتها من المحذوفات." else "تمت استعادة الفاتورة.",
    ) { snapshot -> com.almadinaexpress.app.data.collectionVisibilityDatabase(snapshot, invoiceId, hidden) }

    fun purgeTrash(orderIds: Set<String>, invoiceIds: Set<String>, onDone: () -> Unit) = launchBusy {
        require(!_state.value.offlineCache) { "اتصل بالإنترنت وحدّث المحذوفات أولًا." }
        val current = _state.value.snapshot ?: error("يجب تسجيل الدخول أولًا.")
        try {
            val updated = repository.purgeTrash(current, orderIds, invoiceIds)
            if (_state.value.snapshot?.userId != current.userId) return@launchBusy
            acceptSnapshot(updated)
            require(updated.orders.none { it.id in orderIds } && updated.purgedCollectionIds.containsAll(invoiceIds)) { "لم يصل تأكيد الحذف. حدّث المحذوفات قبل المحاولة مجددًا." }
            showMessage("تم حذف العناصر المحددة من سلة المحذوفات.")
            onDone()
        } catch (error: ApiException) {
            if (_state.value.snapshot?.userId == current.userId) repository.trashConflictSnapshot(error, current.userId)?.let { acceptSnapshot(it) }
            throw error
        }
    }

    fun restoreOrder(orderId: String) = launchBusy {
        val current = _state.value.snapshot ?: error("يجب تسجيل الدخول أولًا.")
        require(current.orders.any { it.id == orderId && current.canTrash(it) }) { "لا تملك صلاحية استعادة هذا الطرد." }
        val retention = applyTrashRetention(current.database)
        val maintained = if (retention.changed) {
            repository.saveDatabase(current, retention.database)
        } else {
            current
        }
        require(maintained.orders.any { it.id == orderId && it.deleted }) {
            "انتهت مدة الاستعادة وحُذف الطرد نهائيًا."
        }
        val now = Instant.now().toString()
        val restoredDatabase = maintained.database.withArray("orders", maintained.database.array("orders").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") == orderId) raw.updated(
                "deleted" to bool(false),
                "deletedAt" to text(""),
                "updatedAt" to text(now),
            ) else raw
        })
        acceptSnapshot(repository.saveDatabase(maintained, restoredDatabase))
        showMessage("تمت استعادة الطرد.")
    }

    fun markNoticeRead(notice: NoticeItem) = mutateDatabase(null) { snapshot ->
        snapshot.database.withArray("notices", snapshot.database.array("notices").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") == notice.id) raw.updated("read" to bool(true)) else raw
        })
    }

    fun deleteNotice(noticeId: String) = launchBusy {
        acceptSnapshot(repository.clearNotices(listOf(noticeId)))
        showMessage("تم حذف الإشعار.")
    }

    fun clearAllNotices() = launchBusy {
        val ids = _state.value.snapshot?.notices?.map { it.id }.orEmpty()
        if (ids.isEmpty()) return@launchBusy
        acceptSnapshot(repository.clearNotices(ids))
        showMessage("تم حذف جميع الإشعارات.")
    }

    fun createCollection(orderIds: List<String>, onDone: () -> Unit = {}) = mutateDatabase("تم إنشاء فاتورة التحصيل.", onDone) { snapshot ->
        val user = snapshot.currentUser ?: error("الحساب غير متاح.")
        require(user.role == Role.MERCHANT) { "إنشاء الفاتورة متاح للمستخدم." }
        require(orderIds.isNotEmpty()) { "اختر طردًا واصلًا أو راجعًا لم تتم تسويته." }
        val selectedOrders = snapshot.orders.filter {
            it.id in orderIds &&
                it.merchantId == user.id &&
                !it.deleted &&
                it.status in listOf(OrderStatus.DELIVERED, OrderStatus.RETURNED) &&
                !isOrderInvoicedForCurrentShipment(it, snapshot.collections)
        }
        require(selectedOrders.isNotEmpty()) { "لا توجد طرود مؤهلة لإنشاء الفاتورة." }
        val delivered = selectedOrders.filter { it.status == OrderStatus.DELIVERED }
        val returned = selectedOrders.filter { it.status == OrderStatus.RETURNED }
        val grossAmount = delivered.sumOf { it.amount }
        val deliveryFees = delivered.sumOf { it.deliveryFee }
        val returnFeeValues = returned.map { order ->
            val storedZone = order.raw.string("deliveryZone").ifBlank { order.governorate }
            order to returnDeliveryFee(user.membership, deliveryZoneFrom(storedZone, order.city))
        }
        val returnFeeDetails = returnFeeValues.map { (order, fee) ->
            buildJsonObject {
                put("orderId", order.id)
                put("fee", fee)
            }
        }
        val returnFees = returnFeeValues.sumOf { it.second }
        val nextCollection = snapshot.database.integer("nextCollection").takeIf { it > 0 }
            ?: (618000 + snapshot.collections.size)
        val now = Instant.now().toString()
        val candidate = buildJsonObject {
            put("id", newId("collection"))
            put("merchantId", user.id)
            put("merchantName", user.name)
            put("invoiceNumber", "#$nextCollection")
            put("orderIds", buildJsonArray { selectedOrders.forEach { add(JsonPrimitive(it.id)) } })
            put("grossAmount", grossAmount)
            put("deliveryFees", deliveryFees)
            put("returnFees", returnFees)
            put("returnFeeDetails", JsonArray(returnFeeDetails))
            put("netAmount", grossAmount - deliveryFees - returnFees)
            put("deliveredCount", delivered.size)
            put("returnedCount", returned.size)
            put("status", "pending")
            put("verificationCode", newCollectionVerificationCode())
            put("authorizedRecipient", "")
            put("createdAt", now)
            put("updatedAt", now)
            put("scheduledAt", Instant.now().plusSeconds(86_400).toString())
        }
        snapshot.database
            .withArray("collections", listOf(candidate) + snapshot.database.array("collections"))
            .updated("nextCollection" to number(nextCollection + 1))
    }

    fun regenerateCollectionVerificationCode(invoice: CollectionItem) = mutateDatabase("تم إنشاء كود تحقق جديد للفاتورة.") { snapshot ->
        val user = snapshot.currentUser ?: error("الحساب غير متاح.")
        require(user.role == Role.MERCHANT && invoice.merchantId == user.id) { "كود التحقق متاح لصاحب الفاتورة فقط." }
        require(invoice.status != "paid") { "تم تسليم هذه الفاتورة ولا يمكن تغيير كودها." }
        snapshot.database.withArray("collections", snapshot.database.array("collections").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") == invoice.id) raw.updated(
                "verificationCode" to text(newCollectionVerificationCode()),
                "updatedAt" to text(Instant.now().toString()),
            ) else raw
        })
    }

    fun prepareCollection(invoice: CollectionItem) = launchBusy {
        acceptSnapshot(repository.prepareCollection(invoice.id))
        showMessage("تم تجهيز الفاتورة وإشعار المستخدم.")
    }

    fun verifyCollection(invoice: CollectionItem, code: String) = launchBusy {
        require(Regex("^[0-9]{4}$").matches(normalizeDigits(code))) { "أدخل كود التحقق المكوّن من 4 أرقام." }
        acceptSnapshot(repository.verifyCollection(invoice.id, normalizeDigits(code)))
        showMessage("تم التحقق وتسليم التحصيل.")
    }

    fun shipScannedOrder(trackingNumber: String, onDone: () -> Unit = {}) = launchBusy {
        acceptSnapshot(repository.shipScannedOrder(trackingNumber))
        showMessage("تم شحن الطرد وإرسال إشعار للمستخدم.")
        onDone()
    }

    fun broadcast(audience: String, userId: String?, title: String, message: String, onDone: () -> Unit = {}) = launchBusy {
        require(title.trim().length in 3..80) { "عنوان الإشعار يجب أن يكون بين 3 و80 حرفًا." }
        require(message.trim().length in 5..500) { "نص الإشعار يجب أن يكون بين 5 و500 حرف." }
        acceptSnapshot(repository.broadcast(audience, userId, title.trim(), message.trim()))
        showMessage("تم إرسال الإشعار.")
        onDone()
    }

    fun addAccount(name: String, phone: String, email: String, password: String, role: Role, membership: Membership, onDone: () -> Unit = {}) = mutateDatabase("تم إنشاء الحساب.", onDone) { snapshot ->
        require(snapshot.currentUser?.role == Role.ADMIN) { "هذه العملية متاحة للمسؤول." }
        require(name.trim().length >= 2) { "أدخل الاسم." }
        require(Regex("^05[0-9]{8}$").matches(phone)) { "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام." }
        require(android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()) { "البريد الإلكتروني غير صحيح." }
        require(password.length >= 8 && password.any(Char::isDigit) && password.any { !it.isLetterOrDigit() }) { "كلمة المرور يجب أن تحتوي على حرف ورقم ورمز." }
        val now = Instant.now().toString()
        val raw = buildJsonObject {
            put("id", newId(if (role == Role.COURIER) "courier" else "merchant"))
            put("name", name.trim())
            put("email", email.trim().lowercase())
            put("password", password)
            put("phone", phone)
            put("store", name.trim())
            put("role", if (role == Role.COURIER) "courier" else "merchant")
            if (role == Role.MERCHANT) put("membership", membership.apiValue)
            put("joinedAt", now)
            put("avatarColor", "#087C45")
        }
        snapshot.database.withArray("users", snapshot.database.array("users") + raw)
    }

    fun updateMembership(userId: String, membership: Membership) = mutateDatabase("تم تحديث نوع الحساب.") { snapshot ->
        snapshot.database.withArray("users", snapshot.database.array("users").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") == userId) raw.updated("membership" to text(membership.apiValue)) else raw
        })
    }

    fun updateAccountByAdmin(userId: String, name: String, phone: String, email: String, store: String, onDone: () -> Unit = {}) =
        mutateDatabase("تم تحديث معلومات الحساب.", onDone) { snapshot ->
            require(snapshot.currentUser?.role == Role.ADMIN) { "هذه العملية متاحة للمسؤول." }
            require(name.trim().length >= 2) { "أدخل الاسم بصورة صحيحة." }
            require(Regex("^05[0-9]{8}$").matches(phone.trim())) { "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام." }
            require(android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()) { "البريد الإلكتروني غير صحيح." }
            require(store.trim().isNotEmpty()) { "أدخل اسم الحساب أو المتجر." }
            snapshot.database.withArray("users", snapshot.database.array("users").map { element ->
                val raw = element.jsonObject
                if (raw.string("id") == userId) raw.updated(
                    "name" to text(name.trim()),
                    "phone" to text(phone.trim()),
                    "email" to text(email.trim().lowercase()),
                    "store" to text(store.trim()),
                ) else raw
            })
        }

    fun deleteAccountByAdmin(userId: String) = mutateDatabase("تم حذف الحساب من النظام.") { snapshot ->
        require(userId != snapshot.userId) { "لا يمكن حذف حساب المسؤول الحالي." }
        snapshot.database.withArray("users", snapshot.database.array("users").filter { it.jsonObject.string("id") != userId })
    }

    fun broadcastAccountProfile(name: String, phone: String, email: String, store: String) = mutateDatabase("تم حفظ معلومات المسؤول.") { snapshot ->
        snapshot.database.withArray("users", snapshot.database.array("users").map { element ->
            val raw = element.jsonObject
            if (raw.string("id") == snapshot.userId) raw.updated(
                "name" to text(name.trim()), "phone" to text(phone.trim()), "email" to text(email.trim()), "store" to text(store.trim()),
            ) else raw
        })
    }

    fun changePassword(current: String, next: String, confirm: String, signOutAll: Boolean) = launchBusy {
        require(next == confirm) { "تأكيد كلمة المرور غير مطابق." }
        val result = repository.changePassword(current, next, signOutAll)
        repository.disableBiometricLogin()
        _state.value = _state.value.copy(
            biometricLoginAvailable = false,
            biometricAccountEmail = null,
        )
        if (result["signedOut"]?.toString() == "true") {
            repository.clearLocalSession()
            _state.value = _state.value.copy(snapshot = null, message = "تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة.")
        } else {
            refresh()
            showMessage("تم تغيير كلمة المرور.")
        }
    }

    fun loadAccountDeletionStatus() {
        val ownerId = _state.value.snapshot?.userId ?: return
        if (_state.value.accountDeletionLoading) return
        _state.value = _state.value.copy(accountDeletionLoading = true, accountDeletionError = null)
        viewModelScope.launch {
            try {
                val result = repository.accountDeletionStatus()
                if (_state.value.snapshot?.userId == ownerId) {
                    _state.value = _state.value.copy(accountDeletion = result)
                }
            } catch (error: Throwable) {
                if (_state.value.snapshot?.userId == ownerId) {
                    _state.value = _state.value.copy(accountDeletion = null, accountDeletionError = readable(error))
                    if (error is ApiException && error.status == 401) fail(error)
                }
            } finally {
                if (_state.value.snapshot?.userId == ownerId) _state.value = _state.value.copy(accountDeletionLoading = false)
            }
        }
    }

    fun requestOwnAccountDeletion(password: String, onAccepted: () -> Unit) = launchBusy {
        val ownerId = _state.value.snapshot?.userId ?: error("يجب تسجيل الدخول أولًا.")
        require(!_state.value.accountDeletionLoading && _state.value.accountDeletion != null) {
            "اتصل بالإنترنت وحدّث حالة طلب حذف الحساب أولًا."
        }
        require(password.isNotBlank()) { "أدخل كلمة المرور الحالية لتأكيد الطلب." }
        _state.value = _state.value.copy(accountDeletionError = null)
        try {
            val result = repository.requestAccountDeletion(password)
            if (_state.value.snapshot?.userId != ownerId) return@launchBusy
            require(result.request != null) { "لم يؤكد الخادم تسجيل الطلب. حدّث حالته قبل إعادة المحاولة." }
            _state.value = _state.value.copy(accountDeletion = result)
            onAccepted()
            showMessage("تم تسجيل طلب حذف الحساب. احتفظ برقم الطلب ورابط متابعته.")
        } catch (error: Throwable) {
            if (_state.value.snapshot?.userId == ownerId) _state.value = _state.value.copy(accountDeletionError = readable(error))
            throw error
        }
    }

    fun deleteOwnAccount(password: String) = launchBusy {
        require(!_state.value.accountDeletionLoading && _state.value.accountDeletion?.eligible == true) {
            "حدّث حالة الطلب وتحقق من اكتمال التسوية قبل الحذف الفوري. يمكنك تقديم طلب حذف الحساب الآن."
        }
        require(password.isNotBlank()) { "أدخل كلمة المرور الحالية لتأكيد الحذف." }
        val currentUser = _state.value.snapshot?.currentUser
        try {
            repository.deleteAccount(password)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(accountDeletion = null, accountDeletionError = readable(error))
            throw error
        }
        currentUser?.let { repository.forgetAvailableAccount(it.id, it.email) }
        repository.disableBiometricLogin()
        repository.clearLocalSession()
        pollingJob?.cancel()
        _state.value = _state.value.copy(
            snapshot = null,
            biometricLoginAvailable = false,
            biometricAccountEmail = null,
            availableAccounts = repository.availableAccounts(),
            accountDeletion = null,
            accountDeletionError = null,
            accountDeletionLoading = false,
            message = "تم حذف الحساب وبياناته نهائيًا.",
        )
    }

    fun setTheme(value: String) {
        val selectedTheme = normalizeThemePreference(value)
        repository.setPreference(SecureStore.KEY_THEME, selectedTheme)
        _state.value = _state.value.copy(theme = selectedTheme)
    }

    fun setSounds(value: Boolean) {
        repository.setPreference(SecureStore.KEY_SOUNDS, value.toString())
        _state.value = _state.value.copy(sounds = value)
        refreshNotificationPermission()
    }

    fun setNotifications(value: Boolean) {
        repository.setPreference(SecureStore.KEY_NOTIFICATIONS, value.toString())
        _state.value = _state.value.copy(notifications = value)
    }

    fun testNotification() {
        refreshNotificationPermission()
        if (!_state.value.notificationPermissionGranted) {
            notificationPermissionResult(false)
            return
        }
        NotificationHelper.showTest(getApplication())
    }

    fun refreshNotificationPermission() {
        val allowed = NotificationHelper.notificationsAllowed(getApplication())
        if (_state.value.notificationPermissionGranted != allowed) {
            _state.value = _state.value.copy(notificationPermissionGranted = allowed)
        }
    }

    fun notificationPermissionResult(granted: Boolean) {
        if (granted) setNotifications(true)
        refreshNotificationPermission()
        if (!granted) _state.value = _state.value.copy(
            message = "إذن الإشعارات غير مفعّل. يمكنك السماح به من إعدادات إشعارات الهاتف.",
            messageError = true,
        )
    }

    fun reportScannerError(message: String) {
        _state.value = _state.value.copy(message = message, messageError = true)
    }

    fun consumeMessage() {
        _state.value = _state.value.copy(message = null)
    }

    private fun mutateDatabase(message: String?, onDone: () -> Unit = {}, transform: (SessionSnapshot) -> JsonObject) {
        launchBusy {
            val current = _state.value.snapshot ?: error("يجب تسجيل الدخول أولًا.")
            val nextDatabase = applyTrashRetention(transform(current)).database
            acceptSnapshot(repository.saveDatabase(current, nextDatabase))
            message?.let(::showMessage)
            onDone()
        }
    }

    private fun launchBusy(block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.value = _state.value.copy(busy = true, message = null)
        viewModelScope.launch {
            try {
                block()
            } catch (_: CancellationException) {
                // Cancellation is not a failed transaction or a login error.
            } catch (error: Exception) {
                fail(error)
            } finally {
                _state.value = _state.value.copy(busy = false)
            }
        }
    }

    private fun acceptSnapshot(snapshot: SessionSnapshot, notify: Boolean = true, replacingAccount: Boolean = false) {
        val current = _state.value.snapshot
        if (!acceptsSnapshot(current?.userId, current?.revision, snapshot.userId, snapshot.revision, replacingAccount)) return
        if (current == snapshot && !_state.value.offlineCache && !_state.value.booting) return
        val sameAccount = _state.value.snapshot?.userId == snapshot.userId
        val pending = if (snapshot.currentUser?.role == Role.ADMIN) restorePendingParcelCodeRequest(snapshot.userId) else null
        pendingParcelCodeRequest = pending
        val availableAccounts = snapshot.currentUser?.let(repository::rememberAccount) ?: repository.availableAccounts()
        _state.value = _state.value.copy(
            snapshot = snapshot,
            booting = false,
            offlineCache = false,
            availableAccounts = availableAccounts,
            parcelCodePendingCount = pending?.count,
            parcelCodePendingLabel = pending?.label,
            accountDeletion = if (sameAccount) _state.value.accountDeletion else null,
            accountDeletionError = if (sameAccount) _state.value.accountDeletionError else null,
            accountDeletionLoading = if (sameAccount) _state.value.accountDeletionLoading else false,
        )
        if (notify) NotificationHelper.recordAndNotify(getApplication(), snapshot.notices)
    }

    private suspend fun maintainTrash(snapshot: SessionSnapshot): SessionSnapshot {
        val retention = applyTrashRetention(snapshot.database)
        if (!retention.changed) return snapshot
        return runCatching { repository.saveDatabase(snapshot, retention.database) }.getOrDefault(snapshot)
    }

    private fun startPolling() {
        pollingJob?.cancel()
        if (!foreground || _state.value.snapshot == null) return
        pollingJob = viewModelScope.launch {
            while (true) {
                delay(30_000)
                refresh(silent = true)
            }
        }
    }

    private fun fail(error: Throwable) {
        if (error is CancellationException) return
        if (error is ApiException && error.status == 409) {
            _state.value.snapshot?.userId?.let { owner ->
                repository.trashConflictSnapshot(error, owner)?.let { acceptSnapshot(it, notify = false) }
            }
        }
        if (error is ApiException && error.status == 401) {
            repository.clearLocalSession()
            _state.value = _state.value.copy(snapshot = null, offlineCache = false, message = "انتهت جلسة الدخول. سجّل الدخول مجددًا.", messageError = true)
            pollingJob?.cancel()
            return
        }
        _state.value = _state.value.copy(message = readable(error), messageError = true)
    }

    private fun readable(error: Throwable): String = when (error) {
        is ApiException -> error.message
        is IllegalArgumentException -> error.message ?: "تحقق من البيانات المدخلة."
        else -> "تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مجددًا."
    }

    private fun showMessage(value: String) {
        _state.value = _state.value.copy(message = value, messageError = false)
    }

    private fun validateRegistration(input: RegistrationInput) {
        require(input.name.trim().length >= 2) { "أدخل الاسم الكامل." }
        require(Regex("^05[0-9]{8}$").matches(input.phone)) { "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام." }
        require(input.store.trim().isNotEmpty()) { "أدخل اسم المتجر." }
        require(android.util.Patterns.EMAIL_ADDRESS.matcher(input.email.trim()).matches()) { "البريد الإلكتروني غير صحيح." }
        require(input.governorate.isNotBlank() && input.city.isNotBlank() && input.address.length >= 2) { "أكمل عنوان الحساب." }
        require(input.password.length >= 8 && input.password.any(Char::isDigit) && input.password.any { !it.isLetterOrDigit() }) { "كلمة المرور يجب أن تحتوي على حرف ورقم ورمز." }
    }

    private fun normalizeDigits(value: String): String = value
        .replace('٠', '0').replace('١', '1').replace('٢', '2').replace('٣', '3').replace('٤', '4')
        .replace('٥', '5').replace('٦', '6').replace('٧', '7').replace('٨', '8').replace('٩', '9')

    private fun newCollectionVerificationCode(): String = (1000 + SecureRandom().nextInt(9000)).toString()
}
