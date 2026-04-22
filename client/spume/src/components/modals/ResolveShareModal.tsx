// inbound share-link resolver.
//
// when the page loads with `#?share=<token>` in the url, App mounts this
// modal and hands it the token. the modal:
//   1. decodes + validates the token (errors → "invalid link" view)
//   2. looks up an existing remote whose peer_addr matches `s.n` (node id)
//   3. if found → navigates to the entity (album/playlist/artist) on that
//      remote, or to the remote's feed for kinds without a detail route
//   4. if not found → renders two ctas: "add remote" (opens AddRemoteModal
//      pre-filled with the node id) and "open in app" (deep link).
//
// in all paths the modal calls `onClose` so App can clear the share param
// from the url. resolution runs once per opened token.
//
// matches the visual language of TagSelectorModal / AddMusicModal via the
// shared `Modal` shell.

import { createResource, createSignal, Show, type Component } from "solid-js";
import { Modal } from "./Modal";
import { decodeShareToken, type SharePayloadV1 } from "../../utils/permalink";
import { getRemoteByPeerAddr } from "../../app/services/remotes/remoteManager";
import { getDefaultRoute } from "../../music/utils/routing";
import { setHighlightedSongId } from "../../music/state/highlightedSong";
import { debug } from "../../utils/logger";

export interface ResolveShareModalProps {
  /** the raw token from the share param. modal stays mounted until cleared. */
  token: string | null;
  /** called once the modal is dismissed (success or otherwise). */
  onClose: () => void;
  /** open AddRemoteModal pre-filled with the share's node id. */
  onAddRemote: (nodeId: string) => void;
}

type ResolveState =
  | { kind: "decoding" }
  | { kind: "invalid"; error: string }
  | { kind: "matched"; payload: SharePayloadV1; targetUrl: string }
  | { kind: "unmatched"; payload: SharePayloadV1 };

export const ResolveShareModal: Component<ResolveShareModalProps> = (props) => {
  const [navigated, setNavigated] = createSignal(false);

  const [state] = createResource(
    () => props.token,
    async (token): Promise<ResolveState> => {
      if (!token) return { kind: "decoding" };
      let payload: SharePayloadV1;
      try {
        payload = decodeShareToken(token);
      } catch (e) {
        return { kind: "invalid", error: e instanceof Error ? e.message : String(e) };
      }
      // node-id match takes precedence — http origin matching could be a
      // future addition (would need to query remotes by base_url).
      const nodeId = payload.s.n;
      if (nodeId) {
        const remote = await getRemoteByPeerAddr(nodeId);
        if (remote) {
          const targetUrl = entityRouteFor(payload, remote.remote_id);
          debug("ResolveShareModal", `matched remote ${remote.name} -> ${targetUrl}`);
          // for song shares with parent album id, prime the highlight signal
          // before navigating so AlbumDetailView picks it up on mount.
          if (payload.k === "song" && payload.p) {
            setHighlightedSongId(payload.i);
          }
          // auto-navigate. setting hash here triggers HashRouter; the modal
          // closes itself on the next tick via the effect below.
          setTimeout(() => {
            window.location.hash = targetUrl;
            setNavigated(true);
            props.onClose();
          }, 250);
          return { kind: "matched", payload, targetUrl };
        }
      }
      return { kind: "unmatched", payload };
    }
  );

  const isOpen = () => props.token !== null && !navigated();

  return (
    <Modal isOpen={isOpen()} onClose={props.onClose} title="open shared link" size="md">
      <div class="p-4 space-y-4">
        <Show when={state.loading || state()?.kind === "decoding"}>
          <p class="text-sm text-[var(--color-text-secondary)]">opening shared link…</p>
        </Show>

        <Show when={state()?.kind === "invalid"}>
          {(_) => {
            const s = state() as Extract<ResolveState, { kind: "invalid" }>;
            return (
              <>
                <p class="text-sm text-[var(--color-text-primary)]">
                  this share link looks invalid.
                </p>
                <p class="text-xs font-mono text-[var(--color-text-tertiary)] break-all">
                  {s.error}
                </p>
                <div class="flex justify-end">
                  <button
                    type="button"
                    onClick={props.onClose}
                    class="px-3 py-1.5 text-sm rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]"
                  >
                    close
                  </button>
                </div>
              </>
            );
          }}
        </Show>

        <Show when={state()?.kind === "matched"}>
          {(_) => {
            const s = state() as Extract<ResolveState, { kind: "matched" }>;
            return (
              <p class="text-sm text-[var(--color-text-secondary)]">
                opening {s.payload.k} on connected remote…
              </p>
            );
          }}
        </Show>

        <Show when={state()?.kind === "unmatched"}>
          {(_) => {
            const s = state() as Extract<ResolveState, { kind: "unmatched" }>;
            const nodeId = s.payload.s.n;
            const title = s.payload.t;
            return (
              <>
                <p class="text-sm text-[var(--color-text-primary)]">
                  shared {s.payload.k}
                  {title ? ` "${title}"` : ""} is on a remote you haven't connected to yet.
                </p>
                <Show when={nodeId}>
                  <p class="text-xs font-mono text-[var(--color-text-tertiary)] break-all">
                    node {nodeId}
                  </p>
                </Show>
                <div class="flex flex-wrap gap-2 pt-2">
                  <Show when={nodeId}>
                    <button
                      type="button"
                      onClick={() => {
                        const id = s.payload.s.n!;
                        props.onAddRemote(id);
                        props.onClose();
                      }}
                      class="px-3 py-2 text-sm rounded-md bg-[var(--color-accent)] text-white border border-transparent hover:opacity-90"
                    >
                      add remote
                    </button>
                  </Show>
                  <a
                    href={`freqhole://o/${props.token ?? ""}`}
                    class="px-3 py-2 text-sm rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]"
                  >
                    open in app
                  </a>
                  <button
                    type="button"
                    onClick={props.onClose}
                    class="px-3 py-2 text-sm rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    cancel
                  </button>
                </div>
              </>
            );
          }}
        </Show>
      </div>
    </Modal>
  );
};

// ---- internal --------------------------------------------------------------

function entityRouteFor(payload: SharePayloadV1, remoteId: string): string {
  switch (payload.k) {
    case "album":
      return `/${remoteId}/albums/${encodeURIComponent(payload.i)}`;
    case "playlist":
      return `/${remoteId}/playlists/${encodeURIComponent(payload.i)}`;
    case "artist":
      return `/${remoteId}/artists/${encodeURIComponent(payload.i)}`;
    case "song":
      // song-detail route doesn't exist — land on the album page when we
      // know it (highlight is set separately), otherwise drop to feed.
      if (payload.p) {
        return `/${remoteId}/albums/${encodeURIComponent(payload.p)}`;
      }
      return getDefaultRoute(remoteId);
    default:
      return getDefaultRoute(remoteId);
  }
}
