// shared FormData field names + helpers for the "review before send"
// annotation (see grimoire's import_session_send_targetz /
// migrations/079) - tags a music/video upload's resulting session with
// the remote it should be sent to once reviewed.
//
// why FormData at all, rather than a separate typed parameter on
// Transport.upload(): HttpTransport's real multipart POST has to carry
// this as actual form fields regardless (that's what a multipart request
// *is*) - the IPC/P2P transports (CharnelLocalTransport, CharnelTransport,
// WasmTransport) then translate that same FormData into their own JSON
// body before sending it over invoke()/iroh. one shared shape in one
// place (this file) beats a second, parallel channel that HttpTransport
// would still have to fold back into form fields anyway. this only
// centralizes the encode/decode so every caller uses named constants and
// a typed helper instead of hand-rolled `formData.get("...")` + manual
// string narrowing.
//
// only meaningful for music/video uploads to CharnelLocalTransport (the
// local-first "review before send" flow always targets the local
// grimoire instance via IPC) - CharnelTransport/WasmTransport's upload()
// send directly to an external peer, where a "review before send" target
// doesn't apply, so they don't read these fields.

const TARGET_REMOTE_ID_FIELD = "target_remote_id";
const TARGET_REMOTE_NAME_FIELD = "target_remote_name";

export interface ImportSendTarget {
  targetRemoteId?: string;
  targetRemoteName?: string;
}

/** appends `target`'s fields onto `formData`, if set. no-op for an
 * absent/empty target. */
export function appendImportSendTarget(
  formData: FormData,
  target: ImportSendTarget | undefined,
): void {
  if (target?.targetRemoteId) formData.append(TARGET_REMOTE_ID_FIELD, target.targetRemoteId);
  if (target?.targetRemoteName) formData.append(TARGET_REMOTE_NAME_FIELD, target.targetRemoteName);
}

/** reads back whatever `appendImportSendTarget` wrote, shaped as the
 * snake_case body fields grimoire's upload_music/import_music_paths
 * handlers expect. returns an empty object (not undefined) when absent,
 * so callers can always spread it directly into a request body. */
export function readImportSendTarget(formData: FormData): {
  target_remote_id?: string;
  target_remote_name?: string;
} {
  const out: { target_remote_id?: string; target_remote_name?: string } = {};
  const id = formData.get(TARGET_REMOTE_ID_FIELD);
  if (typeof id === "string" && id) out.target_remote_id = id;
  const name = formData.get(TARGET_REMOTE_NAME_FIELD);
  if (typeof name === "string" && name) out.target_remote_name = name;
  return out;
}
