// Permission writes can be paused for a coordinated rollback (docs/brightframe/14-staging-readiness.md):
// with BF_PERMISSION_WRITES_PAUSED=1, nothing that the previous build couldn't read back is written —
// approvals, blocks, channel changes, old-record decisions, requests, more-time asks and answers, bedtime
// extensions and device assignments are refused. Viewing, playback and reading are unaffected.

export const permissionWritesPaused = () => process.env.BF_PERMISSION_WRITES_PAUSED === "1";

export class PermissionWritesPaused extends Error {
  constructor() { super("Brightframe is being updated. Changes to permissions are paused for a few minutes."); this.name = "PermissionWritesPaused"; }
}

export function assertPermissionWritesOpen() {
  if (permissionWritesPaused()) throw new PermissionWritesPaused();
}
