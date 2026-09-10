package com.almadinaexpress.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalUriHandler
import com.almadinaexpress.app.BuildConfig

internal val PUBLIC_WEBSITE_ORIGIN: String = BuildConfig.API_BASE_URL.substringBefore("/api/almadina/")

@Composable
internal fun PublicWebsiteLink(title: String, path: String) {
    ExternalWebsiteLink(title, PUBLIC_WEBSITE_ORIGIN + path)
}

@Composable
internal fun ExternalWebsiteLink(title: String, url: String) {
    val uriHandler = LocalUriHandler.current
    var failed by remember(url) { mutableStateOf(false) }
    TextButton(onClick = { failed = runCatching { uriHandler.openUri(url) }.isFailure }) { Text(title) }
    if (failed) Text("تعذر فتح المتصفح. حاول مجددًا.", color = MaterialTheme.colorScheme.error)
}

@Composable
internal fun PublicPolicyLinks() {
    PublicWebsiteLink("سياسة الخصوصية على الموقع", "/privacy")
    PublicWebsiteLink("طلب حذف الحساب ومتابعته على الموقع", "/delete-account")
}
