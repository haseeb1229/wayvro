import { systemIntents } from './deferred';
import { parseWayvroPath } from './parse-path';

/**
 * Expo Router SDK 57 `+native-intent` hook (`redirectSystemPath({ path, initial })`, verified in
 * expo-router 57.0.25 `build/types.d.ts` / `build/getLinkingConfig.js`; no redirects are configured, so the raw system
 * path arrives here unmodified). EVERY system-delivered path is parsed by the bounded allowlist; a recognised intent is
 * held in memory and resolved later against fresh server state (PendingIntentRunner), and the router itself is always
 * sent to the entry route, which applies the app policy, the session, required actions and the restoration resolver.
 * The router therefore never parses an external path. Pure and total: it never throws.
 */
export function redirectSystemPath(event: { readonly path: string; readonly initial: boolean }, now: number = Date.now()): string {
  const parsed = parseWayvroPath(event.path);
  if (parsed.kind === 'intent') systemIntents.hold(parsed.intent, now);
  return '/';
}
