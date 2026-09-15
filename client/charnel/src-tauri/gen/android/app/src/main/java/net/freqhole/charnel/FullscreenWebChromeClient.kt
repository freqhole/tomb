package net.freqhole.charnel

import android.net.Uri
import android.util.Log
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
    companion object {
        private const val TAG = "FullscreenWebChrome"
    }

    private var customView: View? = null
    private var customViewCallback: CustomViewCallback? = null

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        Log.d(TAG, "onShowCustomView called (already showing: ${customView != null})")
        if (customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback
        val decor = activity.window.decorView as ViewGroup
        decor.addView(
            view,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        SystemBars.hide(activity)
        Log.d(TAG, "system bars hide requested")
    }

    override fun onHideCustomView() {
        Log.d(TAG, "onHideCustomView called (had view: ${customView != null})")
        val view = customView ?: return
        val decor = activity.window.decorView as ViewGroup
        decor.removeView(view)
        SystemBars.show(activity)
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
