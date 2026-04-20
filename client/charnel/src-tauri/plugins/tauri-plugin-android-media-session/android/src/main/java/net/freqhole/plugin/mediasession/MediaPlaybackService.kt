package net.freqhole.plugin.mediasession

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.session.MediaSessionCompat
import android.util.Log
import androidx.media.session.MediaButtonReceiver

/**
 * minimal foreground service that hosts the media playback notification.
 *
 * the plugin constructs the Notification and passes it in via intent extra;
 * this service only exists so android keeps the app alive for background
 * audio on modern android versions (foregroundServiceType=mediaPlayback).
 *
 * also routes ACTION_MEDIA_BUTTON intents (from the notification's action
 * buttons and external media keys/headsets) to the active MediaSessionCompat
 * so the session callback fires.
 */
class MediaPlaybackService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    /**
     * acquire a partial wake lock so the cpu (and the webview's js thread)
     * stays alive between tracks while playback is ongoing. without this the
     * `<audio>` `ended` event in js may fire late or not at all when the
     * screen is off, stalling the queue.
     *
     * uses a generous safety timeout and is re-acquired on every state
     * update, so a stuck "playing" state can't hold the cpu indefinitely.
     */
    private fun acquireWakeLock() {
        try {
            // release any prior lock so we always get a fresh timeout window.
            wakeLock?.takeIf { it.isHeld }?.release()
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            val lock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "freqhole:playback",
            )
            lock.setReferenceCounted(false)
            // 30 minutes is a safety net; the plugin re-issues "is_playing"
            // updates frequently enough that we'll re-acquire well before this.
            lock.acquire(30L * 60L * 1000L)
            wakeLock = lock
        } catch (t: Throwable) {
            Log.w(TAG, "acquireWakeLock failed", t)
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.takeIf { it.isHeld }?.release()
        } catch (t: Throwable) {
            Log.w(TAG, "releaseWakeLock failed", t)
        }
        wakeLock = null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand: action=${intent?.action} startId=$startId")
        // first: forward media button intents to the active session so that
        // notification action buttons (prev/play-pause/next) actually do
        // something. this is a no-op for our own "post the notification"
        // intent because that one has no ACTION_MEDIA_BUTTON action.
        val session = activeSession
        if (session != null && intent != null) {
            MediaButtonReceiver.handleIntent(session, intent)
        }

        @Suppress("DEPRECATION")
        val notification: Notification? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent?.getParcelableExtra(EXTRA_NOTIFICATION, Notification::class.java)
            } else {
                intent?.getParcelableExtra(EXTRA_NOTIFICATION)
            }
        val isPlaying = intent?.getBooleanExtra(EXTRA_IS_PLAYING, false) ?: false
        Log.i(TAG, "onStartCommand: notification=${notification != null} isPlaying=$isPlaying")

        if (notification != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                Log.i(TAG, "onStartCommand: startForeground OK")
            } catch (t: Throwable) {
                Log.w(TAG, "onStartCommand: startForeground failed", t)
            }

            // hold a partial wake lock while playing so the webview js
            // thread isn't suspended between tracks. release as soon as
            // we transition to paused/stopped to avoid wasting battery.
            if (isPlaying) {
                acquireWakeLock()
            } else {
                releaseWakeLock()
            }

            // IMPORTANT: do not call stopForeground here, even when paused.
            // detaching from foreground state lets android kill the service
            // after a few minutes idle, and a backgrounded app can't restart
            // a foreground service (ForegroundServiceStartNotAllowedException).
            // keeping the service foreground while paused means the
            // notification stays sticky (good — user can resume from it) and
            // subsequent metadata/state updates don't need to re-create the
            // service from background. it's torn down only by clear() /
            // explicit stop from the plugin.
        }

        return START_NOT_STICKY
    }

    companion object {
        private const val TAG = "MediaPlaybackService"
        const val EXTRA_NOTIFICATION = "notification"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val NOTIFICATION_ID = 0x1337

        // set by MediaSessionPlugin on load; used by onStartCommand to
        // dispatch ACTION_MEDIA_BUTTON events to the session callback.
        @JvmStatic
        var activeSession: MediaSessionCompat? = null
    }
}
