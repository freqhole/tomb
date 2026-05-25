// shared arg shape for the three hub roles + the artist circle role
// under `roles/`. albums use their own self-contained arg type
// (`DrawAlbumArgs`). callers typically build a `DrawNodeArgs` (see
// `draw/drawNode.ts`) and let the dispatcher narrow into one of
// these per-role shapes.

import type { ArtistNodeData, NodeState } from "../../types";

export interface DrawRoleArgs {
  ctx: CanvasRenderingContext2D;
  artist: ArtistNodeData;
  /** world-space center x. */
  x: number;
  /** world-space center y. */
  y: number;
  /** diameter / edge length in world units. */
  size: number;
  state: NodeState;
  zoom: number;
  /** show hover label chip for hub nodes. */
  showLabel?: boolean;
  ringColor?: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  onImageReady?: () => void;
  /** rAF timestamp in ms (for marquee + loading-comet animation). */
  time?: number;
  /** notify caller that marquee is active and needs another frame. */
  onMarquee?: () => void;
  /** paint the animated comet-trail loading indicator. */
  loading?: boolean;
  /** notify caller that the comet trail needs another frame. */
  onLoading?: () => void;
}
