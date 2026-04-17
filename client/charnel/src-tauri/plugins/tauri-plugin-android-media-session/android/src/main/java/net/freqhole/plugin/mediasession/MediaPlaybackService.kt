package net.freqhole.plugin.mediasession

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.support.v4.media.session.MediaSessionCompat
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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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

        if (notification != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }

            // when paused, detach from foreground so the user can swipe the
            // notification away. the MediaSession remains active regardless.
            if (!isPlaying) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_DETACH)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(false)
                }
            }
        }

        return START_NOT_STICKY
    }

    companion object {
        const val EXTRA_NOTIFICATION = "notification"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val NOTIFICATION_ID = 0x1337

        // set by MediaSessionPlugin on load; used by onStartCommand to
        // dispatch ACTION_MEDIA_BUTTON events to the session callback.
        @JvmStatic
        var activeSession: MediaSessionCompat? = null
    }
}
