/**
 * Expo Router SDK 57 native-intent hook: every system-delivered path goes through the bounded intent allowlist
 * (core/intents) before the router sees anything; the router itself always receives the entry route.
 */
export { redirectSystemPath } from '../core/intents/native-intent';
