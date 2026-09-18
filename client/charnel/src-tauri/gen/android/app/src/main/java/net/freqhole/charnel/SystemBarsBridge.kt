package net.freqhole.charnel

import android.webkit.JavascriptInterface

/**
 * JS-callable bridge for hiding/showing the status + gesture nav bars,
 * installed via WebView.addJavascriptInterface in MainActivity.onWebViewCreate.
 *
 * needed because Element.requestFullscreen() (called by VideoMiniPlayer.tsx)
 * is handled entirely as in-page CSS fullscreen on this WebView - confirmed
 * via logging that WebChromeClient.onShowCustomView never fires for it, only
 * for the legacy webkitEnterFullscreen() video API. so JS drives the system
 * bars directly via document's fullscreenchange event instead of relying on
 * the custom-view callback.
 */
class SystemBarsBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun hide() {
        activity.runOnUiThread { SystemBars.hide(activity) }
    }

    @JavascriptInterface
    fun show() {
        activity.runOnUiThread { SystemBars.show(activity) }
    }
}
