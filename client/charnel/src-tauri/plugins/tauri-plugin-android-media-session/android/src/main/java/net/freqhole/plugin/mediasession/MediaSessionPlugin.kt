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
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
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
    private var currentDurationMs: Long = 0L

    // audio focus state.
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var hasAudioFocus: Boolean = false
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                hasAudioFocus = false
                emitAction("pause")
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // pause for transient loss too. (we could implement ducking
                // by emitting a separate action, but most music apps just
                // pause to be safe.)
                emitAction("pause")
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                hasAudioFocus = true
                // only resume if we were playing before; the js side tracks
                // user-pause intent so it can decide whether to honor this.
                emitAction("play")
            }
        }
    }

    // native track-end watchdog. when the playback state goes to "playing"
    // with a known position+duration, we schedule a callback for the
    // expected end-of-track time. on fire, we emit an "expectedend" action
    // that js uses as a backup trigger to advance the queue if the
    // `<audio>` `ended` event was throttled by webview while the screen
    // was off. cancelled and rescheduled on every state/position update.
    private val mainHandler = Handler(Looper.getMainLooper())
    private var endWatchdog: Runnable? = null

    override fun load(webView: WebView) {
        super.load(webView)
        audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        createNotificationChannel()
        requestNotificationPermission()
        initSession()
    }

    private fun requestNotificationPermission() {
        // POST_NOTIFICATIONS is only a runtime permission on android 13+ (API 33).
        // without it, MediaStyle notifications are silently suppressed, which
        // means no pull-down media controls and no lock-screen widget.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ActivityCompat.checkSelfPermission(
            activity, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) return
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
        val o = JSObject()
        o.put("action", name)
        trigger("action", o)
    }

    /**
     * request audio focus for music playback. on api 26+ uses the modern
     * AudioFocusRequest api; on older versions falls back to the
     * deprecated requestAudioFocus(listener, stream, durationHint) form.
     * idempotent — returns true if focus is held after the call.
     */
    private fun requestAudioFocus(): Boolean {
        if (hasAudioFocus) return true
        val am = audioManager ?: return false
        val result: Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusListener, mainHandler)
                .setWillPauseWhenDucked(false)
                .setAcceptsDelayedFocusGain(false)
                .build()
            audioFocusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN,
            )
        }
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return hasAudioFocus
    }

    private fun abandonAudioFocus() {
        if (!hasAudioFocus) return
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(focusListener)
        }
        hasAudioFocus = false
    }

    /**
     * (re)schedule the native end-of-track watchdog. cancels any pending
     * callback and, if currently playing with a known duration, posts a
     * new one to fire shortly after the track is expected to end.
     *
     * the small fudge factor (750ms) avoids racing the real `ended` event
     * when js is running normally; the watchdog is purely a backup for
     * when js has been throttled while the screen is off.
     */
    private fun rescheduleEndWatchdog() {
        endWatchdog?.let { mainHandler.removeCallbacks(it) }
        endWatchdog = null
        if (currentState != PlaybackStateCompat.STATE_PLAYING) return
        val duration = currentDurationMs
        if (duration <= 0L) return
        val rate = if (currentSpeed > 0f) currentSpeed else 1f
        val remainingMs = ((duration - currentPosition).coerceAtLeast(0L).toFloat() / rate).toLong()
        // ignore tiny remainders; nothing meaningful to schedule.
        if (remainingMs < 250L) return
        val delay = remainingMs + 750L
        val r = Runnable {
            endWatchdog = null
            // only emit if we still believe we should be playing. the js
            // handler is responsible for ignoring this if its `<audio>`
            // `ended` event already fired (the common case).
            if (currentState == PlaybackStateCompat.STATE_PLAYING) {
                emitAction("expectedend")
            }
        }
        endWatchdog = r
        mainHandler.postDelayed(r, delay)
    }

    @Command
    fun setMetadata(invoke: Invoke) {
        val args = invoke.parseArgs(MetadataArgs::class.java)
        val b = MediaMetadataCompat.Builder()
        b.putString(MediaMetadataCompat.METADATA_KEY_TITLE, args.title)
        args.artist?.let { b.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, it) }
        args.album?.let { b.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, it) }
        args.durationMs?.let {
            b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, it)
            currentDurationMs = it
        }

        currentBitmap = args.artworkBase64?.let { decodeArtwork(it) }
        currentBitmap?.let {
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, it)
        }

        metadataBuilder = b
        mediaSession?.setMetadata(b.build())
        // a metadata change usually means a new track started; reset
        // position so the watchdog math stays sensible until the js side
        // sends its first setPosition for the new track.
        currentPosition = 0L
        rescheduleEndWatchdog()
        updateNotification()
        invoke.resolve()
    }

    @Command
    fun setPlaybackState(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackStateArgs::class.java)
        currentState = when (args.state) {
            "playing" -> PlaybackStateCompat.STATE_PLAYING
            "paused" -> PlaybackStateCompat.STATE_PAUSED
            "stopped" -> PlaybackStateCompat.STATE_STOPPED
            else -> PlaybackStateCompat.STATE_NONE
        }
        currentSpeed = if (currentState == PlaybackStateCompat.STATE_PLAYING) 1f else 0f
        // manage audio focus alongside playback state.
        if (currentState == PlaybackStateCompat.STATE_PLAYING) {
            requestAudioFocus()
        } else {
            abandonAudioFocus()
        }
        applyPlaybackState()
        rescheduleEndWatchdog()
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
            currentDurationMs = args.durationMs
        }
        applyPlaybackState()
        rescheduleEndWatchdog()
        invoke.resolve()
    }

    @Command
    fun clear(invoke: Invoke) {
        currentState = PlaybackStateCompat.STATE_STOPPED
        applyPlaybackState()
        endWatchdog?.let { mainHandler.removeCallbacks(it) }
        endWatchdog = null
        abandonAudioFocus()
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
