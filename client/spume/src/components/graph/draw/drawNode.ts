// unified entry point for drawing any graph node. dispatches on
// `nodeRole(node)` to the per-role draw fn under `roles/`. callers
// build one args object and don't need to know whether the node is
// an album tile, an artist circle, or one of the three hub
// silhouettes.

import type { AlbumNodeData, ArtistNodeData, GraphNodeData, NodeState } from "../types";
import { nodeKind } from "../types";
import { drawAlbum } from "./roles/album";
import { drawArtist } from "./roles/artist";
import { drawRelationHub } from "./roles/relationHub";
import { drawRelationValueHub } from "./roles/relationValueHub";
import { drawRemoteHub } from "./roles/remoteHub";
import { nodeRole } from "./shared/roleDispatch";

export interface DrawNodeArgs {
  ctx: CanvasRenderingContext2D;
  node: GraphNodeData;
  /** world-space center x. */
  x: number;
  /** world-space center y. */
  y: number;
  /** edge length (square) / diameter (circle) / bounding diameter
   *  (hub silhouettes) in world units. */
  size: number;
  state: NodeState;
  zoom: number;
  /** show the hover label chip for hub nodes, or the bottom label
   *  bar for album tiles. */
  showLabel?: boolean;
  ringColor?: string;
  bgColor?: string;
  textColor?: string;
  /** album-tile fallback subtitle color (ignored by other roles). */
  mutedColor?: string;
  borderColor?: string;
  onImageReady?: () => void;
  /** rAF timestamp (ms). */
  time?: number;
  /** notify caller that marquee text needs another frame. */
  onMarquee?: () => void;
  /** paint the animated loading comet around the silhouette. */
  loading?: boolean;
  /** notify caller that the comet needs another frame. */
  onLoading?: () => void;
}

export function drawNode(args: DrawNodeArgs): void {
  const role = nodeRole(args.node);
  if (role === "album") {
    drawAlbum({
      ctx: args.ctx,
      album: args.node as AlbumNodeData,
      x: args.x,
      y: args.y,
      size: args.size,
      state: args.state,
      zoom: args.zoom,
      showLabel: args.showLabel,
      time: args.time,
      ringColor: args.ringColor,
      bgColor: args.bgColor,
      textColor: args.textColor,
      mutedColor: args.mutedColor,
      borderColor: args.borderColor,
      onImageReady: args.onImageReady,
      onMarquee: args.onMarquee,
      loading: args.loading,
      onLoading: args.onLoading,
    });
    return;
  }
  // all four non-album roles share the `ArtistNodeData` shape.
  const artistArgs = {
    ctx: args.ctx,
    artist: args.node as ArtistNodeData,
    x: args.x,
    y: args.y,
    size: args.size,
    state: args.state,
    zoom: args.zoom,
    showLabel: args.showLabel,
    ringColor: args.ringColor,
    bgColor: args.bgColor,
    textColor: args.textColor,
    borderColor: args.borderColor,
    onImageReady: args.onImageReady,
    time: args.time,
    onMarquee: args.onMarquee,
    loading: args.loading,
    onLoading: args.onLoading,
  };
  switch (role) {
    case "artist":
      drawArtist(artistArgs);
      return;
    case "remoteHub":
      drawRemoteHub(artistArgs);
      return;
    case "relationHub":
      drawRelationHub(artistArgs);
      return;
    case "relationValueHub":
      drawRelationValueHub(artistArgs);
      return;
  }
  // exhaustiveness check — `nodeRole` is a closed union.
  const _exhaustive: never = role;
  void _exhaustive;
  void nodeKind;
}
