package net.freqhole.charnel

import android.os.Bundle
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // let Android draw system bars itself so the webview doesn't extend behind them.
    // this avoids the player bar rendering under the navigation bar.
    WindowCompat.setDecorFitsSystemWindows(window, true)
    super.onCreate(savedInstanceState)
  }
}
