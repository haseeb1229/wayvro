/*
 * Per-UID traffic counters from `adb shell dumpsys netstats` (closure correction §12: per-app attribution of the
 * emulator network inventory). Android 9+ keeps eBPF per-UID counters and prints them under `mAppUidStatsMap:` as
 *     uid rxBytes rxPackets txBytes txPackets
 *     10123 45678 90 12345 67
 * Returns { rxBytes, txBytes } for `uid`, or null when the section or the row is absent (never a guessed 0).
 */
export function appUidBytes(dump, uid) {
  const lines = dump.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith('mAppUidStatsMap'));
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (t === '' || /^uid\s+rxBytes/i.test(t)) continue;
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(t);
    if (!m) break;
    if (Number(m[1]) === uid) return { rxBytes: Number(m[2]), txBytes: Number(m[4]) };
  }
  return null;
}

/** `adb shell cmd package list packages -U <pkg>` → the app's UID (`package:<pkg> uid:10123`), or null. */
export function packageUid(listing, pkg) {
  const m = new RegExp(`package:${pkg.replaceAll('.', '\\.')}\\s+uid:(\\d+)`).exec(listing);
  return m ? Number(m[1]) : null;
}
