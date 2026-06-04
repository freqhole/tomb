export function valueKind(id: string): string | undefined {
  const parts = id.split("::");
  // value/group ids are encoded as `{prefix}::{remoteId}::{kind}::{slug}`;
  // the kind sits at index 2, not 1.
  return (parts[0] === "value" || parts[0] === "group") && parts.length >= 4
    ? parts[2]
    : undefined;
}

// extract the remote id from an entity node id. covers the encoded
// forms produced by nodeIds.ts:
//   artist::{remoteId}::{artistId}
//   album::{remoteId}::{albumId}
//   remote::{remoteId}
//   relation::{remoteId}::{kind}
//   value::{remoteId}::{kind}::{slug}
//   group::{remoteId}::{kind}::{slug}
// returns undefined for root or unrecognised shapes.
export function nodeRemoteId(id: string): string | undefined {
  const parts = id.split("::");
  if (parts.length < 2) return undefined;
  switch (parts[0]) {
    case "remote":
    case "artist":
    case "album":
    case "relation":
    case "value":
    case "group":
      return parts[1];
    default:
      return undefined;
  }
}
