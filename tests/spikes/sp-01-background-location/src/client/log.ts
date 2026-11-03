/**
 * Spike log (protocol §5.2/§10): counts, states and machine codes only — never a position, URL, token or OS message.
 * React Native writes console output to logcat under the tag `ReactNativeJS`; every spike line starts with
 * `WayvroSp01` so the lead filters with: adb logcat -d -v time -s ReactNativeJS:* | grep WayvroSp01
 */
type LogValue = number | boolean | null | 'active' | 'background' | 'inactive' | 'unknown' | `${Uppercase<string>}`;

export function log(event: string, fields: Readonly<Record<string, LogValue>> = {}): void {
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  console.log(`WayvroSp01 ${event}${kv ? ` ${kv}` : ''}`);
}
