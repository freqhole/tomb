package net.freqhole.charnel

import android.view.ViewGroup
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * hide/show the status + gesture nav bars via WindowInsetsControllerCompat -
 * the modern API Android actually respects for this (legacy
 * View.SYSTEM_UI_FLAG_* bits don't reliably hide the gesture nav bar on
 * modern Android). shared by FullscreenWebChromeClient (platform video
 * fullscreen, if it ever fires) and SystemBarsBridge (the JS-callable path,
 * needed because Element.requestFullscreen() on this WebView is handled
 * entirely as in-page CSS fullscreen and never invokes onShowCustomView).
 */
object SystemBars {
    fun hide(activity: MainActivity) {
        val decor = activity.window.decorView as ViewGroup
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        val controller = WindowInsetsControllerCompat(activity.window, decor)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    fun show(activity: MainActivity) {
        val decor = activity.window.decorView as ViewGroup
        val controller = WindowInsetsControllerCompat(activity.window, decor)
        controller.show(WindowInsetsCompat.Type.systemBars())
        // restore MainActivity.onCreate's baseline (see its comment: lets
        // Android draw system bars itself so the webview/player bar don't
        // render underneath them outside of fullscreen video).
        WindowCompat.setDecorFitsSystemWindows(activity.window, true)
    }
}
