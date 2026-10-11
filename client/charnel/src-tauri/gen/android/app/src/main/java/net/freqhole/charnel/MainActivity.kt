package net.freqhole.charnel

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  // constructed eagerly (not inside onWebViewCreate) so its
  // registerForActivityResult call happens during activity construction,
  // before onCreate/onStart - registerForActivityResult must run before the
  // activity is STARTED, but onWebViewCreate fires later (after onResume),
  // which crashed once a RustWebChromeClient started being built there.
  private val rustWebChromeClient = RustWebChromeClient(this)

  override fun onCreate(savedInstanceState: Bundle?) {
    // let Android draw system bars itself so the webview doesn't extend behind them.
    // this avoids the player bar rendering under the navigation bar.
    WindowCompat.setDecorFitsSystemWindows(window, true)
    super.onCreate(savedInstanceState)
  }

  // wry's default WebChromeClient (generated/RustWebChromeClient.kt) never
  // implements fullscreen video - see FullscreenWebChromeClient's doc comment.
  //
  // wry calls setWebView() (-> this hook) BEFORE it calls
  // webView.setWebChromeClient(RustWebChromeClient), so assigning our client
  // synchronously here gets silently overwritten and onShowCustomView never
  // reaches us - the fullscreen button then does nothing (the stock client
  // dismisses the custom view instantly). posting to the main looper runs
  // after wry has finished its own setup on this same message.
  override fun onWebViewCreate(webView: WebView) {
    var fullscreenClient: FullscreenWebChromeClient? = null
    val exitFullscreenOnBack = object : OnBackPressedCallback(false) {
      override fun handleOnBackPressed() {
        fullscreenClient?.exitFullscreen()
      }
    }
    onBackPressedDispatcher.addCallback(this, exitFullscreenOnBack)

    webView.post {
      val client = FullscreenWebChromeClient(this, rustWebChromeClient) { fullscreen ->
        exitFullscreenOnBack.isEnabled = fullscreen
      }
      fullscreenClient = client
      webView.webChromeClient = client
    }

    // JS can also drive the system bars directly on fullscreenchange; see
    // SystemBarsBridge's doc comment.
    webView.addJavascriptInterface(SystemBarsBridge(this), "AndroidSystemBars")
  }
}
