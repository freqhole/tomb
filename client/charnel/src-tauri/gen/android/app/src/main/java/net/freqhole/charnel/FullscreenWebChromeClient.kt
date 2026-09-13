package net.freqhole.charnel

import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView

/**
 * wry's auto-generated RustWebChromeClient (see generated/RustWebChromeClient.kt,
 * regenerated on every `tauri android` build - never hand-edit it) stubs out
 * fullscreen video support: its onShowCustomView immediately calls
 * `callback.onCustomViewHidden()` without ever attaching the custom view Android
 * hands it, so a `<video>` element's Fullscreen API request silently does
 * nothing. Android's WebView requires the *app*, not the WebView itself, to
 * display that view - this wraps a real RustWebChromeClient (delegating every
 * other callback - permissions, js dialogs, file chooser - to it unchanged) and
 * adds the fullscreen handling wry's default never implements. installed from
 * MainActivity.onWebViewCreate().
 */
class FullscreenWebChromeClient(
    private val activity: MainActivity,
    private val delegate: RustWebChromeClient
) : WebChromeClient() {
    private var customView: View? = null
    private var customViewCallback: CustomViewCallback? = null
    private var originalSystemUiVisibility: Int = 0

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback
        val decor = activity.window.decorView as ViewGroup
        @Suppress("DEPRECATION")
        originalSystemUiVisibility = decor.systemUiVisibility
        decor.addView(
            view,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        @Suppress("DEPRECATION")
        decor.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    override fun onHideCustomView() {
        val view = customView ?: return
        val decor = activity.window.decorView as ViewGroup
        decor.removeView(view)
        @Suppress("DEPRECATION")
        decor.systemUiVisibility = originalSystemUiVisibility
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
    }

    // everything else is unrelated to fullscreen - forward to wry's own
    // client so camera/mic permission prompts, js alert/confirm/prompt, and
    // the file-chooser flow (used by the QR-scanner/file-import pickers)
    // keep working exactly as before.
    override fun onPermissionRequest(request: PermissionRequest) = delegate.onPermissionRequest(request)

    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
        delegate.onJsAlert(view, url, message, result)

    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
        delegate.onJsConfirm(view, url, message, result)

    override fun onJsPrompt(
        view: WebView,
        url: String,
        message: String,
        defaultValue: String,
        result: JsPromptResult
    ): Boolean = delegate.onJsPrompt(view, url, message, defaultValue, result)

    override fun onGeolocationPermissionsShowPrompt(
        origin: String,
        callback: GeolocationPermissions.Callback
    ) = delegate.onGeolocationPermissionsShowPrompt(origin, callback)

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri?>?>,
        fileChooserParams: FileChooserParams
    ): Boolean = delegate.onShowFileChooser(webView, filePathCallback, fileChooserParams)
}
