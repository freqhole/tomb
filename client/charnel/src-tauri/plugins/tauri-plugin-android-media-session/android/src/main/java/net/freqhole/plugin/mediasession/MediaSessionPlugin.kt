package net.freqhole.plugin.mediasession

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat
import androidx.media.session.MediaButtonReceiver
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class MetadataArgs {
    var title: String = ""
    var artist: String? = null
    var album: String? = null
    var durationMs: Long? = null
    var artworkBase64: String? = null
}

@InvokeArg
class PlaybackStateArgs {
    // "playing" | "paused" | "stopped"
    var state: String = "paused"
}

@InvokeArg
class PositionArgs {
    var positionMs: Long = 0L
    var durationMs: Long = 0L
    var playbackRate: Float = 1f
}

@TauriPlugin
class MediaSessionPlugin(private val activity: Activity) : Plugin(activity) {

    private var mediaSession: MediaSessionCompat? = null
    private var metadataBuilder: MediaMetadataCompat.Builder = MediaMetadataCompat.Builder()
    private var currentState: Int = PlaybackStateCompat.STATE_NONE
    private var currentPosition: Long = 0L
    private var currentSpeed: Float = 1f
    private var currentBitmap: Bitmap? = null

    override fun load(webView: WebView) {
        super.load(webView)
        Log.i(TAG, "plugin loading")
        createNotificationChannel()
        requestNotificationPermission()
        initSession()
        Log.i(TAG, "plugin ready (sessionToken=${mediaSession?.sessionToken != null})")
    }

    private fun requestNotificationPermission() {
        // POST_NOTIFICATIONS is only a runtime permission on android 13+ (API 33).
        // without it, MediaStyle notifications are silently suppressed, which
        // means no pull-down media controls and no lock-screen widget.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ActivityCompat.checkSelfPermission(
            activity, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            Log.i(TAG, "POST_NOTIFICATIONS already granted")
            return
        }
        Log.i(TAG, "requesting POST_NOTIFICATIONS")
        try {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                REQ_POST_NOTIFICATIONS,
            )
        } catch (t: Throwable) {
            Log.w(TAG, "failed to request POST_NOTIFICATIONS", t)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Playback",
                    NotificationManager.IMPORTANCE_LOW,
                )
                channel.setShowBadge(false)
                channel.setSound(null, null)
                channel.enableVibration(false)
                mgr.createNotificationChannel(channel)
            }
        }
    }

    private fun initSession() {
        val session = MediaSessionCompat(activity, "freqhole-media-session")
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() { emitAction("play") }
            override fun onPause() { emitAction("pause") }
            override fun onStop() { emitAction("pause") }
            override fun onSkipToNext() { emitAction("nexttrack") }
            override fun onSkipToPrevious() { emitAction("previoustrack") }
            override fun onSeekTo(pos: Long) {
                val o = JSObject()
                o.put("action", "seekto")
                o.put("positionMs", pos)
                trigger("action", o)
            }
        })
        session.isActive = true
        mediaSession = session
        MediaPlaybackService.activeSession = session
    }

    private fun emitAction(name: String) {
        Log.i(TAG, "emitAction: $name")
        val o = JSObject()
        o.put("action", name)
        trigger("action", o)
    }

    @Command
    fun setMetadata(invoke: Invoke) {
        val args = invoke.parseArgs(MetadataArgs::class.java)
        Log.i(TAG, "setMetadata: title='${args.title}' artist='${args.artist}' hasArt=${args.artworkBase64 != null}")
        val b = MediaMetadataCompat.Builder()
        b.putString(MediaMetadataCompat.METADATA_KEY_TITLE, args.title)
        args.artist?.let { b.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, it) }
        args.album?.let { b.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, it) }
        args.durationMs?.let { b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, it) }

        currentBitmap = args.artworkBase64?.let { decodeArtwork(it) }
        currentBitmap?.let {
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, it)
        }

        metadataBuilder = b
        mediaSession?.setMetadata(b.build())
        updateNotification()
        invoke.resolve()
    }

    @Command
    fun setPlaybackState(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackStateArgs::class.java)
        Log.i(TAG, "setPlaybackState: ${args.state}")
        currentState = when (args.state) {
            "playing" -> PlaybackStateCompat.STATE_PLAYING
            "paused" -> PlaybackStateCompat.STATE_PAUSED
            "stopped" -> PlaybackStateCompat.STATE_STOPPED
            else -> PlaybackStateCompat.STATE_NONE
        }
        currentSpeed = if (currentState == PlaybackStateCompat.STATE_PLAYING) 1f else 0f
        applyPlaybackState()
        updateNotification()
        invoke.resolve()
    }

    @Command
    fun setPosition(invoke: Invoke) {
        val args = invoke.parseArgs(PositionArgs::class.java)
        currentPosition = args.positionMs
        currentSpeed = if (currentState == PlaybackStateCompat.STATE_PLAYING) args.playbackRate else 0f
        if (args.durationMs > 0L) {
            metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, args.durationMs)
            mediaSession?.setMetadata(metadataBuilder.build())
        }
        applyPlaybackState()
        invoke.resolve()
    }

    @Command
    fun clear(invoke: Invoke) {
        currentState = PlaybackStateCompat.STATE_STOPPED
        applyPlaybackState()
        try {
            activity.stopService(Intent(activity, MediaPlaybackService::class.java))
        } catch (_: Throwable) {
        }
        invoke.resolve()
    }

    private fun applyPlaybackState() {
        val actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_STOP
        val state = PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(currentState, currentPosition, currentSpeed)
            .build()
        mediaSession?.setPlaybackState(state)
    }

    private fun decodeArtwork(b64: String): Bitmap? = try {
        // strip data URL prefix if present
        val raw = b64.substringAfter(",", b64)
        val bytes = Base64.decode(raw, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Throwable) {
        null
    }

    private fun updateNotification() {
        val session = mediaSession ?: return
        val md = session.controller.metadata ?: return
        val title = md.getString(MediaMetadataCompat.METADATA_KEY_TITLE) ?: return
        val artist = md.getString(MediaMetadataCompat.METADATA_KEY_ARTIST)
        val album = md.getString(MediaMetadataCompat.METADATA_KEY_ALBUM)
        val art: Bitmap? = currentBitmap
            ?: md.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART)

        val isPlaying = currentState == PlaybackStateCompat.STATE_PLAYING

        val playPauseIcon = if (isPlaying) {
            android.R.drawable.ic_media_pause
        } else {
            android.R.drawable.ic_media_play
        }
        val playPauseAction = NotificationCompat.Action(
            playPauseIcon,
            if (isPlaying) "Pause" else "Play",
            MediaButtonReceiver.buildMediaButtonPendingIntent(
                activity, PlaybackStateCompat.ACTION_PLAY_PAUSE,
            ),
        )
        val prevAction = NotificationCompat.Action(
            android.R.drawable.ic_media_previous, "Previous",
            MediaButtonReceiver.buildMediaButtonPendingIntent(
                activity, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,
            ),
        )
        val nextAction = NotificationCompat.Action(
            android.R.drawable.ic_media_next, "Next",
            MediaButtonReceiver.buildMediaButtonPendingIntent(
                activity, PlaybackStateCompat.ACTION_SKIP_TO_NEXT,
            ),
        )

        val contentIntent: PendingIntent? = activity.packageManager
            .getLaunchIntentForPackage(activity.packageName)
            ?.let {
                PendingIntent.getActivity(
                    activity, 0, it,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
            }

        val builder = NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(activity.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(artist ?: "")
            .setSubText(album)
            .setLargeIcon(art)
            .setContentIntent(contentIntent)
            .setDeleteIntent(
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    activity, PlaybackStateCompat.ACTION_STOP,
                ),
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .setStyle(
                MediaNotificationCompat.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
                    .setShowCancelButton(true)
                    .setCancelButtonIntent(
                        MediaButtonReceiver.buildMediaButtonPendingIntent(
                            activity, PlaybackStateCompat.ACTION_STOP,
                        ),
                    ),
            )

        val svc = Intent(activity, MediaPlaybackService::class.java)
        svc.putExtra(MediaPlaybackService.EXTRA_NOTIFICATION, builder.build())
        svc.putExtra(MediaPlaybackService.EXTRA_IS_PLAYING, isPlaying)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startForegroundService(svc)
            } else {
                activity.startService(svc)
            }
            Log.i(TAG, "notification posted (isPlaying=$isPlaying)")
        } catch (t: Throwable) {
            // background-start restrictions on android 12+ can throw; ignore.
            // the session is still updated so system media controls still reflect state.
            Log.w(TAG, "startForegroundService failed", t)
        }
    }

    companion object {
        const val CHANNEL_ID = "freqhole-playback"
        private const val TAG = "MediaSessionPlugin"
        private const val REQ_POST_NOTIFICATIONS = 0xBEEF
    }
}
