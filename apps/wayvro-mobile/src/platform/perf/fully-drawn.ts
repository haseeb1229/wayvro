import { requireOptionalNativeModule } from 'expo';
import { useEffect } from 'react';

/**
 * SP-02 §6.1 "interactive" marker (PB-01 Rider home, PB-02 sign-in screen): Android `Activity.reportFullyDrawn()` through
 * the local Expo module `modules/wayvro-fully-drawn` (Kotlin, no third-party code). Release-safe: it is the standard
 * lifecycle signal Android vitals and Macrobenchmark read, not a test hook, and it carries no data. At most once per
 * process — the native side keeps the process-wide flag; the first screen to call wins.
 *
 * The module exists on Android only; on iOS (no build yet, ADR-036) and in Node unit tests it is absent and the marker
 * does nothing — there is no equivalent platform signal to report.
 */
interface FullyDrawnModule {
  reportFullyDrawn(): boolean;
}

let reported = false;

function reportFullyDrawnOnce(): void {
  if (reported) return;
  const native = requireOptionalNativeModule<FullyDrawnModule>('WayvroFullyDrawn');
  if (native === null) return;
  reported = native.reportFullyDrawn();
}

/** Render where the screen first counts as interactive; reports on mount (after the frame is committed). */
export function FullyDrawnMarker(): null {
  useEffect(reportFullyDrawnOnce, []);
  return null;
}
