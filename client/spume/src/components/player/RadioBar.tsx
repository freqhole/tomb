// global radio bar — fixed bottom strip that appears whenever a radio
// session is active. mounted from AppLayout so it survives navigation
// (the actual <audio> element lives here, attached only once).
//
// stacks above the regular PlayerBar when both are visible.

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import {
  leaveRadio,
  radioArtUrl,
  radioCurrentPeerAddr,
  radioError,
  radioListenerCount,
  radioNowPlaying,
  radioStatus,
  setRadioAudioSink,
} from "../../app/services/radio/radioService";

interface RadioBarProps {
  /** extra bottom offset (e.g. when the regular PlayerBar is also visible). */
  bottomOffset?: string;
  onOpenRadioView?: () => void;
}

export function RadioBar(props: RadioBarProps) {
  let mount!: HTMLDivElement;

  // a single, reusable <audio> element for the duration of this app instance.
  // re-used across station tunes so we don't churn DOM nodes.
  const audioEl = (() => {
    const el = document.createElement("audio");
    el.controls = false;
    el.autoplay = true;
    el.preload = "auto";
    el.style.display = "none";
    return el;
  })();

  // give the radio service a sink callback so tuneIntoRadio wires its
  // MediaSource into our persistent <audio> element instead of creating
  // a new one per call.
  setRadioAudioSink(audioEl);

  // mount the element into the bar once on first render. it stays there
  // for the rest of the app lifetime; visibility is purely controlled by
  // the surrounding <Show>, so dom-detach/reattach doesn't kill playback
  // mid-stream.
  createEffect(() => {
    if (mount && audioEl.parentElement !== mount) {
      mount.appendChild(audioEl);
    }
  });

  onCleanup(() => {
    setRadioAudioSink(null);
  });

  const [volume, setVolume] = createSignal(1);
  createEffect(() => {
    audioEl.volume = volume();
  });

  return (
    <Show when={radioStatus() !== "idle"}>
      <div
        class="fixed left-0 right-0 z-50 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border-t border-[var(--color-border-subtle)]"
        style={{
          bottom: props.bottomOffset ?? "0px",
        }}
      >
        <div ref={(el) => (mount = el)} />
        <div class="flex items-center gap-3 px-4 py-2 max-w-screen-2xl mx-auto">
          {/* art thumb — inline from the meta `art` field. falls back to
              the gradient "radio" badge so the bar stays consistent. */}
          <div class="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
            <Show
              when={radioArtUrl()}
              fallback={
                <span class="text-[9px] font-bold tracking-widest opacity-70 text-white">
                  radio
                </span>
              }
            >
              {(url) => <img src={url()} alt="album art" class="w-full h-full object-cover" />}
            </Show>
          </div>
          {/* live indicator */}
          <div
            class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
            classList={{
              "text-red-500": radioStatus() === "playing",
              "text-amber-400": radioStatus() === "connecting",
              "text-red-400": radioStatus() === "error",
            }}
          >
            <span
              class="w-2 h-2 rounded-full"
              classList={{
                "bg-red-500 animate-pulse": radioStatus() === "playing",
                "bg-amber-400 animate-pulse": radioStatus() === "connecting",
                "bg-red-400": radioStatus() === "error",
              }}
            />
            {radioStatus() === "playing"
              ? "live"
              : radioStatus() === "connecting"
                ? "connecting"
                : "error"}
          </div>

          {/* now-playing */}
          <button
            class="flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer p-0"
            onClick={() => props.onOpenRadioView?.()}
            title="open radio view"
          >
            <Show
              when={radioNowPlaying()}
              fallback={
                <div class="text-sm text-[var(--color-text-muted)] truncate">tuning in…</div>
              }
            >
              {(np) => (
                <div class="min-w-0">
                  <div class="text-sm font-medium truncate text-[var(--color-text-primary)]">
                    {np().title}
                  </div>
                  <div class="text-xs text-[var(--color-text-muted)] truncate">
                    {np().artist ?? "unknown artist"}
                    <Show when={np().album}>
                      {" — "}
                      {np().album}
                    </Show>
                  </div>
                </div>
              )}
            </Show>
          </button>

          {/* listener count */}
          <div
            class="text-xs text-[var(--color-text-muted)] tabular-nums hidden sm:block"
            title="listeners"
          >
            {radioListenerCount()} listening
          </div>

          {/* volume */}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume()}
            onInput={(e) => setVolume(parseFloat(e.currentTarget.value))}
            class="w-20 accent-[var(--color-accent-500)] hidden md:block"
            title="volume"
          />

          {/* peer addr (debug-ish) */}
          <Show when={radioCurrentPeerAddr()}>
            <div
              class="text-[10px] text-[var(--color-text-muted)] font-mono hidden lg:block max-w-[120px] truncate"
              title={radioCurrentPeerAddr() ?? ""}
            >
              {radioCurrentPeerAddr()}
            </div>
          </Show>

          {/* stop */}
          <button
            class="px-3 py-1 rounded text-xs font-medium border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer"
            onClick={() => leaveRadio()}
            title="stop and leave radio"
          >
            stop
          </button>
        </div>

        <Show when={radioError()}>
          <div class="px-4 pb-2 text-xs text-red-400 truncate">{radioError()}</div>
        </Show>
      </div>
    </Show>
  );
}
