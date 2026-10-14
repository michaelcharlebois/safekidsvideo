// The server's "now" for time limits and bedtime. Always the real clock — except in LOCAL mode (no Supabase:
// development and the browser walkthroughs) when BF_FAKE_NOW is set: then time starts at that instant when
// the server starts and runs normally from there, so bedtime and day boundaries are deterministic in tests.
// A deployment with Supabase ignores BF_FAKE_NOW entirely.
const fakeStart = !process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.BF_FAKE_NOW ? Date.parse(process.env.BF_FAKE_NOW) : NaN;
const bootedAt = Date.now();

export function serverNow(): Date {
  return Number.isFinite(fakeStart) ? new Date(fakeStart + (Date.now() - bootedAt)) : new Date();
}
