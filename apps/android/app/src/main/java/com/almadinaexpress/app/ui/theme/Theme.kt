package com.almadinaexpress.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat

val BrandGreen = Color(0xFF087C45)
val BrandGreenLight = Color(0xFF12A15D)
val BrandGreenDark = Color(0xFF04562F)
val BrandMint = Color(0xFFE5F5EC)
val AccentPink = Color(0xFFC72F7C)
val Warning = Color(0xFFBC7629)
val ReferenceTeal = Color(0xFF69B7B3)
val ReferenceCyan = Color(0xFF08CDD3)
val ReferenceDarkBackground = Color(0xFF181D22)
val ReferenceDarkSurface = Color(0xFF20262B)
val ReferenceDarkRaised = Color(0xFF292F35)

const val THEME_LIGHT = "light"
const val THEME_DARK = "dark"
const val THEME_SYSTEM = "system"

fun normalizeThemePreference(value: String): String = when (value) {
    THEME_DARK, THEME_SYSTEM -> value
    else -> THEME_LIGHT
}

private val LightColors = lightColorScheme(
    primary = BrandGreen,
    onPrimary = Color.White,
    primaryContainer = BrandMint,
    onPrimaryContainer = BrandGreenDark,
    secondary = Color(0xFF53645A),
    background = Color(0xFFF7F9F7),
    surface = Color.White,
    surfaceVariant = Color(0xFFEEF1EE),
    outline = Color(0xFFCBD2CC),
    error = Color(0xFFB3261E),
)

private val DarkColors = darkColorScheme(
    primary = ReferenceTeal,
    onPrimary = Color(0xFF082F2E),
    primaryContainer = Color(0xFF2C5554),
    onPrimaryContainer = Color(0xFFD6FFFC),
    secondary = ReferenceCyan,
    onSecondary = Color(0xFF003638),
    secondaryContainer = Color(0xFF174B4D),
    onSecondaryContainer = Color(0xFFC5FAFC),
    background = ReferenceDarkBackground,
    surface = ReferenceDarkSurface,
    surfaceVariant = ReferenceDarkRaised,
    onBackground = Color(0xFFF4F6F7),
    onSurface = Color(0xFFF4F6F7),
    onSurfaceVariant = Color(0xFFB5BEC4),
    outline = Color(0xFF465058),
    error = Color(0xFFFFB4AB),
)

@Composable
fun AlmadinaTheme(preference: String, content: @Composable () -> Unit) {
    val systemDark = isSystemInDarkTheme()
    val selectedTheme = normalizeThemePreference(preference)
    val dark = selectedTheme == THEME_DARK || (selectedTheme == THEME_SYSTEM && systemDark)
    val context = LocalContext.current
    // Keep one predictable branded palette across every Android device. Dynamic colors
    // would otherwise replace the application identity with the user's wallpaper colors.
    val colors = if (dark) DarkColors else LightColors

    (context as? Activity)?.window?.let { window ->
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
    MaterialTheme(colorScheme = colors, content = content)
}
