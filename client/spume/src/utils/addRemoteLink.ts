// detects "add remote" share links pasted or scanned anywhere in the app -
// the `?r=<node_id>` query-param scheme (see docs/SEND_TO_REMOTE_PLAN.md)
// used by QR codes, TopNav's own share menu (TopNav.tsx), and
// RemotesSettingsView's share action.

const NODE_ID_RE = /^[0-9a-f]{64}$/i;

/**
 * extracts a bare node_id/peer_addr suitable for AddRemoteModal's address
 * field from a `?r=<node_id>` url (full url, or a bare query fragment) or
 * a bare 64-hex node id. returns null when `text` doesn't look like an
 * add-remote link at all.
 */
export function extractAddRemoteValue(text: string): string | null {
  const trimmed = text.trim();

  try {
    const url = new URL(trimmed);
    const rParam = url.searchParams.get("r");
    if (rParam) return rParam;
  } catch {
    // not a full url
  }

  const match = trimmed.match(/[?&]r=([a-fA-F0-9]{64})/);
  if (match) return match[1];

  return NODE_ID_RE.test(trimmed) ? trimmed : null;
}
