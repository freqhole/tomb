package net.freqhole.charnel

import android.os.Bundle
import android.webkit.WebView
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
  override fun onWebViewCreate(webView: WebView) {
    webView.webChromeClient = FullscreenWebChromeClient(this, rustWebChromeClient)
  }
}
