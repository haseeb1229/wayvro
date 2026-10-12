/**
 * SP-01 spike runtime (candidate A). One module-level instance shared by the UI and the location task, because both
 * run in the same JS runtime that the location foreground service (FGS) keeps alive.
 *
 * Why everything is driven by `tick()`: React Native pauses JS timers while the activity is paused unless a headless
 * JS task is active (JavaTimerManager). expo-task-manager registers one only while a task event is executing, so in
 * the background the location callbacks (every 5 s) are the reliable heartbeat: each one runs a bounded `tick()` that
 * uploads, heartbeats, polls and checks permissions. In the foreground a 1 s UI interval also calls `tick()`.
 *
 * Authority: the receiver's presence is authoritative. Local state only says "this process started tracking because
 * the user tapped Go online". Anything else that finds the location task running (expo-task-manager restoring a
 * persisted task after a crash/kill, a boot, a stray callback) is stopped — never resumed automatically.
 */
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { backoffDelayMs, UPLOAD_BACKOFF } from '../shared/backoff.ts';
import { buildUploadPoint, MAX_POINTS_PER_BATCH, serializeUploadBatch, type AppStateLabel, type ClockSample, type UploadPoint } from '../shared/payload.ts';
import {
  SPIKE_PARAMS,
  type ClientEvent,
  type ClientEventType,
  type ClientOfflineReason,
  type GoOnlineRefusal,
  type LocationProfile,
  type Offer,
  type OfferChannel,
  type OfflineReason,
  type Snapshot,
} from '../shared/protocol.ts';
import { RingBuffer } from '../shared/ring-buffer.ts';
import { api } from './api.ts';
import { DeltaTracker } from './geo-delta.ts';
import { log } from './log.ts';
import { readPermissions } from './permissions.ts';
import { store, type Mode, type Notice, type NoticeKind, type ReceiverConfig } from './storage.ts';

export const LOCATION_TASK = 'wayvro-sp01-location';
export const SPIKE_PACKAGE = 'dev.wayvro.spike.sp01';
const TICK_BUDGET_MS = 4_000;
const WATCHDOG_EVERY_MS = 5_000;
const BATTERY_EVERY_MS = 60_000;
const EVENTS_FLUSH_EVERY_MS = 10_000;

type Session = {
  readonly runId: string;
  readonly profile: LocationProfile;
  readonly startedMs: number;
  readonly buffer: RingBuffer<UploadPoint>;
  readonly delta: DeltaTracker;
  seq: number;
  fixesTotal: number;
  lastFixMs: number;
  lastUploadAttemptMs: number;
  lastUploadOkMs: number;
  uploadFailures: number;
  nextUploadAtMs: number;
  inflight: { readonly startedMs: number; readonly controller: AbortController } | null;
  clock: ClockSample[];
  lastHbMs: number;
  lastPollMs: number;
  lastWatchdogMs: number;
  socketDownSinceMs: number | null;
  socketEverConnected: boolean;
  /** False until the receiver accepted this run's go-online; no upload/heartbeat/poll before that. */
  confirmed: boolean;
};

export type EngineStatus = {
  readonly ready: boolean;
  readonly signedIn: boolean;
  readonly receiver: string | null;
  readonly mode: Mode;
  readonly profile: LocationProfile;
  readonly online: boolean;
  readonly runId: string | null;
  readonly fgsRegistered: boolean | null;
  readonly socket: 'connected' | 'down' | 'off';
  readonly socketDownS: number | null;
  readonly lastUploadAgoS: number | null;
  readonly lastFixAgoS: number | null;
  readonly bufferDepth: number;
  readonly bufferDrops: number;
  readonly uploadFailures: number;
  readonly server: { readonly presence: string; readonly reason: string | null; readonly restricted: boolean; readonly ageS: number } | null;
  readonly counts: Readonly<typeof counts>;
  readonly notice: Notice | null;
  readonly batteryPct: number | null;
  readonly powerSave: boolean | null;
  readonly batteryOptimised: boolean | null;
  readonly tc10Armed: boolean;
};

const counts = {
  fixes: 0,
  fixesAfterStop: 0,
  orphanStops: 0,
  uploadsOk: 0,
  uploadsFailed: 0,
  uploadsRejected: 0,
  pointsAcked: 0,
  offersSocket: 0,
  offersPoll: 0,
  offersSnapshot: 0,
  polls: 0,
  snapshots: 0,
  socketConnects: 0,
  socketDisconnects: 0,
  heartbeats: 0,
};

let ready = false;
let config: ReceiverConfig | null = null;
let mode: Mode = 'rider';
let profile: LocationProfile = 'standard';
let session: Session | null = null;
let socket: Socket | null = null;
let server: Snapshot | null = null;
let serverAtMs = 0;
let notice: Notice | null = null;
let fgsRegistered: boolean | null = null;
let battery: { pct: number | null; powerSave: boolean | null; optimised: boolean | null; readMs: number } = {
  pct: null,
  powerSave: null,
  optimised: null,
  readMs: 0,
};
let pendingEvents: ClientEvent[] = [];
let lastEventsFlushMs = 0;
let eventsFlushing = false;
let tc10Armed = false;
let ticking: Promise<void> | null = null;
const ackedOffers = new Set<string>();
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((l) => l());
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const appStateLabel = (): AppStateLabel => {
  const s = AppState.currentState;
  return s === 'active' || s === 'background' || s === 'inactive' ? s : 'unknown';
};

const newRunId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Expo CodedException codes are UPPER_SNAKE; anything else collapses to a generic code (no OS free text). */
function errorCode(e: unknown): string {
  const code = e !== null && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : '';
  return /^[A-Z0-9_]{3,64}$/.test(code) ? code : 'UNKNOWN_ERROR';
}
const isBackgroundStartRefusal = (e: unknown): boolean => {
  const code = errorCode(e);
  const message = e instanceof Error ? e.message : '';
  return code.includes('FOREGROUND_SERVICE_START_NOT_ALLOWED') || /ForegroundServiceStartNotAllowed|in the background/i.test(message);
};

async function setNotice(kind: NoticeKind, code: string): Promise<void> {
  notice = { kind, code, atDeviceMs: Date.now() };
  await store.setNotice(notice);
  emit();
}
export async function clearNotice(): Promise<void> {
  notice = null;
  await store.setNotice(null);
  emit();
}

async function queueEvent(type: ClientEventType, code?: string, runId?: string): Promise<void> {
  const event: ClientEvent = { type, deviceMs: Date.now(), ...(code ? { code } : {}), ...(runId ? { runId } : {}) };
  pendingEvents = [...pendingEvents, event].slice(-100);
  log('event', { [type]: true });
  await store.setPendingEvents(pendingEvents);
}

async function flushEvents(force = false): Promise<void> {
  const cfg = config;
  if (!cfg || eventsFlushing || pendingEvents.length === 0) return;
  if (!force && Date.now() - lastEventsFlushMs < EVENTS_FLUSH_EVERY_MS) return;
  eventsFlushing = true;
  lastEventsFlushMs = Date.now();
  try {
    const batch = pendingEvents.slice(0, 50);
    const r = await api.events(cfg, batch);
    if (r.ok) {
      pendingEvents = pendingEvents.slice(batch.length);
      await store.setPendingEvents(pendingEvents);
    }
  } finally {
    eventsFlushing = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Start-up and reconciliation (role model §6; protocol TC-07/08/09/15/19)

export async function init(): Promise<void> {
  config = await store.config();
  mode = await store.mode();
  profile = await store.profile();
  notice = await store.notice();
  pendingEvents = await store.pendingEvents();
  // Never auto-resume: a location task that is registered but was not started by a user action in THIS process
  // (expo-task-manager restores persisted tasks when the process starts) is stopped before anything else.
  const registered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (registered && session === null) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    counts.orphanStops += 1;
    await queueEvent('STALE_FGS_STOPPED', 'ON_START');
  }
  fgsRegistered = false;
  ready = true;
  emit();
  if (config) await reconcile('start');
  AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      void reconcile('foreground');
    }
  });
}

async function reconcile(via: 'start' | 'foreground'): Promise<void> {
  const cfg = config;
  if (!cfg) return;
  const snap = await api.snapshot(cfg, via);
  if (snap.ok) applySnapshot(snap.value, null);
  if (session) {
    fgsRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!fgsRegistered) await stopTracking('FGS_LOST', { notifyServer: true, finalFlush: true });
    emit();
    return;
  }
  const intent = await store.onlineIntent();
  if (!intent) return;
  // The user was online in an earlier process that is gone (crash, kill, swipe, reboot, revoke).
  await store.setOnlineIntent(null);
  const perms = await readPermissions();
  const serverOnline = snap.ok && snap.value.presence !== 'OFFLINE' && snap.value.runId === intent.runId;
  if (perms.foreground !== 'granted' || perms.background !== 'granted' || !perms.precise) {
    const reason: ClientOfflineReason = perms.foreground === 'granted' && perms.background === 'granted' ? 'PERMISSION_DOWNGRADED' : 'PERMISSION_REVOKED';
    await queueEvent(reason === 'PERMISSION_REVOKED' ? 'PERMISSION_REVOKED' : 'PERMISSION_DOWNGRADED', 'ON_NEXT_OPEN', intent.runId);
    if (serverOnline) await api.offline(cfg, intent.runId, reason);
    await setNotice('permission-lost', reason);
  } else if (serverOnline) {
    await queueEvent('TRACKING_STOPPED_SHOWN', snap.value.presence, intent.runId);
    await setNotice('tracking-stopped', snap.value.presence);
  } else {
    await setNotice('forced-offline', snap.ok ? (snap.value.offlineReason ?? 'OFFLINE') : 'SERVER_UNREACHABLE');
  }
  await flushEvents(true);
}

// ---------------------------------------------------------------------------------------------------------------
// Sign-in / sign-out / mode / profile

export async function signIn(baseUrlInput: string, token: string): Promise<'ok' | 'INVALID_URL' | 'INVALID_TOKEN' | string> {
  const m = /^http:\/\/((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})\/?$/.exec(baseUrlInput.trim());
  if (!m) return 'INVALID_URL';
  if (!/^spike-local-only-[a-z0-9]{4,32}$/.test(token.trim())) return 'INVALID_TOKEN';
  const port = Number(m[2]);
  const cfg: ReceiverConfig = { baseUrl: `http://${m[1] ?? ''}:${String(port)}`, gatewayUrl: `http://${m[1] ?? ''}:${String(port + 1)}`, token: token.trim() };
  const snap = await api.snapshot(cfg, 'start');
  if (!snap.ok) return snap.code;
  config = cfg;
  await store.setConfig(cfg);
  applySnapshot(snap.value, null);
  emit();
  return 'ok';
}

export async function signOut(): Promise<void> {
  if (session) await goOffline('SIGNED_OUT');
  await queueEvent('SIGNED_OUT');
  await flushEvents(true);
  await store.clearAll();
  config = null;
  server = null;
  notice = null;
  pendingEvents = [];
  mode = 'rider';
  ackedOffers.clear();
  emit();
}

/** Switching to Rider requires being offline first (role model §5); the UI confirms and calls goOffline before this. */
export async function setMode(next: Mode): Promise<boolean> {
  if (next === 'rider' && session) return false;
  mode = next;
  await store.setMode(next);
  emit();
  return true;
}

export async function setProfile(next: LocationProfile): Promise<boolean> {
  if (session) return false;
  profile = next;
  await store.setProfile(next);
  emit();
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Go online / offline

export type GoOnlineOutcome = { ok: true } | { ok: false; refusal: GoOnlineRefusal; code?: string };

export async function goOnline(trigger: 'user' | 'resume' | 'tc10-background' = 'user'): Promise<GoOnlineOutcome> {
  const cfg = config;
  if (!cfg || mode !== 'driver' || session) return { ok: false, refusal: 'START_FAILED', code: 'PRECONDITION' };
  const refuse = async (refusal: GoOnlineRefusal, code?: string): Promise<GoOnlineOutcome> => {
    await queueEvent(refusal === 'START_REFUSED_BACKGROUND' ? 'START_REFUSED_BACKGROUND' : 'GO_ONLINE_REFUSED', code ?? refusal);
    void flushEvents(true);
    return { ok: false, refusal, ...(code ? { code } : {}) };
  };
  const perms = await readPermissions();
  if (perms.foreground !== 'granted') return refuse('FOREGROUND_PERMISSION_DENIED');
  if (!perms.precise) return refuse('PRECISE_LOCATION_REQUIRED');
  if (perms.background !== 'granted') return refuse('BACKGROUND_PERMISSION_DENIED');
  if (!perms.servicesEnabled) return refuse('LOCATION_SERVICES_OFF');
  const pre = await api.snapshot(cfg, trigger === 'resume' ? 'resume' : 'start');
  if (!pre.ok) return refuse('NETWORK', pre.code);
  applySnapshot(pre.value, null);
  if (pre.value.restricted) return refuse('RESTRICTED');

  const p = profile === 'economy' ? SPIKE_PARAMS.economy : SPIKE_PARAMS.standard;
  const now = Date.now();
  const s: Session = {
    runId: newRunId(),
    profile,
    startedMs: now,
    buffer: new RingBuffer<UploadPoint>(SPIKE_PARAMS.bufferCapacity),
    delta: new DeltaTracker(),
    seq: 0,
    fixesTotal: 0,
    lastFixMs: 0,
    lastUploadAttemptMs: now,
    lastUploadOkMs: 0,
    uploadFailures: 0,
    nextUploadAtMs: 0,
    inflight: null,
    clock: [],
    lastHbMs: 0,
    lastPollMs: 0,
    lastWatchdogMs: now,
    socketDownSinceMs: now,
    socketEverConnected: false,
    confirmed: false,
  };
  session = s;
  try {
    // FGS start is only ever a continuation of a user action in the foreground (expo-location also refuses it
    // in the background). TC-10 calls this from the background on purpose to record that refusal.
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: p.accuracy === 'high' ? Location.Accuracy.High : Location.Accuracy.Balanced,
      timeInterval: p.intervalMs,
      distanceInterval: p.distanceM,
      deferredUpdatesInterval: 0,
      mayShowUserSettingsDialog: false,
      foregroundService: {
        notificationTitle: 'SP-01 spike: location on while online',
        notificationBody: 'Test build. Go offline in the app to stop sharing location.',
        killServiceOnDestroy: false,
      },
    });
  } catch (e) {
    session = null;
    const background = isBackgroundStartRefusal(e) || AppState.currentState !== 'active';
    if (background) await setNotice('background-start-refused', 'START_REFUSED_BACKGROUND');
    return refuse(background ? 'START_REFUSED_BACKGROUND' : 'START_FAILED', errorCode(e));
  }
  if (trigger === 'tc10-background') await queueEvent('FGS_STARTED', 'FROM_BACKGROUND', s.runId);
  const online = await api.online(cfg, s.runId);
  if (!online.ok) {
    session = null;
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    return refuse(online.code === 'RESTRICTED' ? 'RESTRICTED' : 'NETWORK', online.code);
  }
  s.confirmed = true;
  applySnapshot(online.value, null);
  fgsRegistered = true;
  await store.setOnlineIntent({ runId: s.runId, sinceDeviceMs: now });
  await clearNotice();
  await queueEvent(trigger === 'resume' ? 'RESUMED_BY_USER' : 'FGS_STARTED', trigger.toUpperCase().replace(/-/g, '_'), s.runId);
  log('online', { interval: p.intervalMs, distance: p.distanceM });
  await sampleClock(cfg, s);
  connectSocket(cfg, s);
  void flushEvents(true);
  emit();
  return { ok: true };
}

export async function goOffline(reason: ClientOfflineReason = 'USER_OFFLINE'): Promise<void> {
  if (session) await queueEvent('OFFLINE_REQUESTED', reason, session.runId);
  await stopTracking(reason, { notifyServer: true, finalFlush: true });
}

/** "Tracking stopped" answered with "stay offline": tell the server the earlier run is over (it would otherwise expire). */
export async function stayOffline(): Promise<void> {
  const cfg = config;
  if (cfg && !session && server && server.presence !== 'OFFLINE' && server.runId) {
    const r = await api.offline(cfg, server.runId, 'USER_OFFLINE');
    if (r.ok) applySnapshot(r.value, null);
  }
  await clearNotice();
}

async function stopTracking(reason: OfflineReason, opts: { notifyServer: boolean; finalFlush: boolean }): Promise<void> {
  const s = session;
  session = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  fgsRegistered = false;
  socket?.disconnect();
  socket = null;
  await store.setOnlineIntent(null);
  if (s) {
    s.inflight?.controller.abort();
    s.inflight = null;
    const cfg = config;
    if (cfg && opts.finalFlush && s.buffer.size > 0) await uploadOnce(cfg, s, true);
    if (cfg && opts.notifyServer) {
      const r = await api.offline(cfg, s.runId, reason);
      if (r.ok) applySnapshot(r.value, null);
    }
    await queueEvent('FGS_STOPPED', reason, s.runId);
    log('offline', { fixes: s.fixesTotal, buffered: s.buffer.size, drops: s.buffer.drops });
  }
  void flushEvents(true);
  emit();
}

/** The server said OFFLINE (restriction, forced offline, TRACKING_LOST, another run): stop, never argue. */
async function applyServerOffline(reason: OfflineReason | null, via: string): Promise<void> {
  if (!session) return;
  const runId = session.runId;
  await stopTracking(reason ?? 'FORCED_OFFLINE', { notifyServer: false, finalFlush: true });
  await queueEvent('FORCED_OFFLINE_APPLIED', `${reason ?? 'UNKNOWN'}:${via.toUpperCase()}`, runId);
  await setNotice('forced-offline', reason ?? 'UNKNOWN');
  void flushEvents(true);
}

// ---------------------------------------------------------------------------------------------------------------
// Location task entry point

export async function onLocationTask(locations: readonly Location.LocationObject[], errorCodeValue: string | null): Promise<void> {
  if (!session) {
    // Orphan invocation: the task fired in a process where the user did not go online (restored task, late callback
    // after stop, headless start). Stop it and record it — never resume tracking silently.
    counts.fixesAfterStop += locations.length;
    counts.orphanStops += 1;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    if (!config) config = await store.config();
    if (pendingEvents.length === 0) pendingEvents = await store.pendingEvents();
    await queueEvent('ORPHAN_TASK_STOPPED', ready ? 'AFTER_STOP' : 'HEADLESS_OR_RESTORED');
    log('orphan', { callbacks: locations.length });
    await flushEvents(true);
    return;
  }
  const s = session;
  if (errorCodeValue) await queueEvent('LOCATION_TASK_ERROR', errorCodeValue, s.runId);
  await refreshBattery(false);
  for (const loc of locations) {
    s.seq += 1;
    s.fixesTotal += 1;
    counts.fixes += 1;
    s.lastFixMs = Date.now();
    s.buffer.push(
      buildUploadPoint({
        runId: s.runId,
        seq: s.seq,
        fixTimeMs: loc.timestamp,
        accuracyM: loc.coords.accuracy,
        deltaM: s.delta.next(loc.coords),
        mocked: loc.mocked,
        appState: appStateLabel(),
        fgsActive: true,
        batteryPct: battery.pct,
        powerSave: battery.powerSave,
      }),
    );
  }
  if (counts.fixes % 60 === 0) log('fixes', { total: counts.fixes, buffered: s.buffer.size, drops: s.buffer.drops });
  await tick('location');
}

// ---------------------------------------------------------------------------------------------------------------
// The tick: watchdog, upload, heartbeat, poll (bounded so a task event never hangs)

/** `server` = the receiver pushed STALE for this run: re-check permissions/provider now (the push is a native event). */
export function tick(source: 'location' | 'ui' | 'server'): Promise<void> {
  if (ticking) return ticking;
  const work = runTick(source).finally(() => {
    ticking = null;
  });
  ticking = work;
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, TICK_BUDGET_MS))]);
}

async function runTick(source: 'location' | 'ui' | 'server'): Promise<void> {
  const now = Date.now();
  const cfg = config;
  const s = session;
  if (cfg && s?.confirmed) {
    if (now - s.lastWatchdogMs >= WATCHDOG_EVERY_MS || source === 'server') await watchdog(s, now);
    if (session === s) {
      if (s.inflight && now - s.inflight.startedMs > 15_000) {
        s.inflight.controller.abort();
        s.inflight = null;
      }
      const due = s.buffer.size >= SPIKE_PARAMS.uploadEveryPoints || (s.buffer.size > 0 && now - s.lastUploadAttemptMs >= SPIKE_PARAMS.uploadEveryMs);
      if (!s.inflight && due && now >= s.nextUploadAtMs) void uploadLoop(cfg, s);
      if (socket?.connected && now - s.lastFixMs <= SPIKE_PARAMS.heartbeatRequiresFixWithinMs && now - s.lastHbMs >= SPIKE_PARAMS.heartbeatEveryMs) {
        s.lastHbMs = now;
        counts.heartbeats += 1;
        socket.emit('hb', { runId: s.runId });
      }
      if (s.socketDownSinceMs !== null && now - s.socketDownSinceMs > SPIKE_PARAMS.socketDownBeforePollMs && now - s.lastPollMs >= SPIKE_PARAMS.pollEveryMs) {
        s.lastPollMs = now;
        counts.polls += 1;
        void api.snapshot(cfg, 'poll').then((r) => {
          if (r.ok && session === s) applySnapshot(r.value, 'poll');
        });
      }
    }
  }
  if (source === 'ui') await refreshBattery(false);
  void flushEvents();
  emit();
}

async function watchdog(s: Session, now: number): Promise<void> {
  s.lastWatchdogMs = now;
  const p = await readPermissions();
  if (session !== s) return;
  let reason: ClientOfflineReason | null = null;
  let event: ClientEventType | null = null;
  if (p.foreground !== 'granted') [reason, event] = ['PERMISSION_REVOKED', 'PERMISSION_REVOKED'];
  else if (p.background !== 'granted') [reason, event] = ['PERMISSION_REVOKED', 'PERMISSION_REVOKED'];
  else if (!p.precise) [reason, event] = ['PERMISSION_DOWNGRADED', 'PERMISSION_DOWNGRADED'];
  else if (!p.servicesEnabled) [reason, event] = ['PROVIDER_DISABLED', 'PROVIDER_DISABLED'];
  if (reason && event) {
    const code = p.foreground !== 'granted' ? 'FOREGROUND' : p.background !== 'granted' ? 'BACKGROUND' : reason;
    await queueEvent(event, code, s.runId);
    await stopTracking(reason, { notifyServer: true, finalFlush: true });
    await setNotice('permission-lost', reason);
    return;
  }
  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await stopTracking('FGS_LOST', { notifyServer: true, finalFlush: true });
    await setNotice('stopped', 'FGS_LOST');
  }
}

async function uploadLoop(cfg: ReceiverConfig, s: Session): Promise<void> {
  // Drain in bounded batches while the run is current and the receiver answers.
  for (let i = 0; i < 20 && session === s && s.buffer.size > 0; i += 1) {
    const ok = await uploadOnce(cfg, s, false);
    if (!ok || s.buffer.size < SPIKE_PARAMS.uploadEveryPoints) return;
  }
}

async function uploadOnce(cfg: ReceiverConfig, s: Session, final: boolean): Promise<boolean> {
  if (s.inflight) return false;
  const points = s.buffer.peek(MAX_POINTS_PER_BATCH);
  if (points.length === 0) return true;
  const clock = s.clock.splice(0);
  const body = serializeUploadBatch({
    runId: s.runId,
    points,
    clock,
    stats: { bufferDepth: s.buffer.size, bufferDrops: s.buffer.drops, fixesTotal: s.fixesTotal },
  });
  const controller = new AbortController();
  const t0 = Date.now();
  s.inflight = { startedMs: t0, controller };
  s.lastUploadAttemptMs = t0;
  const r = await api.points(cfg, body, controller.signal);
  const t1 = Date.now();
  s.inflight = null;
  if (r.ok) {
    s.clock = [...s.clock, { t0, ts: r.value.serverTimeMs, t1 }].slice(-10);
    s.buffer.removeSeqs(new Set(points.map((p) => p.seq)));
    s.uploadFailures = 0;
    s.nextUploadAtMs = 0;
    s.lastUploadOkMs = t1;
    counts.uploadsOk += 1;
    counts.pointsAcked += r.value.stored + r.value.duplicates;
    if (!final && r.value.presence === 'OFFLINE') await applyServerOffline(r.value.offlineReason, 'points');
    return true;
  }
  if (r.status === 400) {
    // A payload the receiver rejects is a harness bug: drop it (counted) instead of retrying forever.
    s.buffer.removeSeqs(new Set(points.map((p) => p.seq)));
    counts.uploadsRejected += 1;
    log('upload_rejected', { points: points.length });
    return false;
  }
  s.clock = [...clock, ...s.clock].slice(-10);
  s.uploadFailures += 1;
  counts.uploadsFailed += 1;
  s.nextUploadAtMs = t1 + backoffDelayMs(s.uploadFailures, UPLOAD_BACKOFF);
  return false;
}

async function sampleClock(cfg: ReceiverConfig, s: Session): Promise<void> {
  const t0 = Date.now();
  const r = await api.time(cfg);
  if (r.ok) s.clock = [...s.clock, { t0, ts: r.value.serverTimeMs, t1: Date.now() }].slice(-10);
}

// ---------------------------------------------------------------------------------------------------------------
// Offer path: Socket.IO primary, HTTP poll when the socket is down > 10 s, snapshot on (re)connect

function connectSocket(cfg: ReceiverConfig, s: Session): void {
  const sock = io(cfg.gatewayUrl, {
    transports: ['websocket'],
    auth: { token: cfg.token, runId: s.runId },
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
    randomizationFactor: 0.5,
    timeout: 10_000,
  });
  socket = sock;
  sock.on('connect', () => {
    if (session !== s) return;
    counts.socketConnects += 1;
    s.socketDownSinceMs = null;
    const reconnect = s.socketEverConnected;
    s.socketEverConnected = true;
    log('socket', { connected: true });
    // Every (re)connect fetches the authoritative snapshot (ADR-005b): realtime delivery is not the source of truth.
    void api.snapshot(cfg, reconnect ? 'reconnect' : 'start').then((r) => {
      if (r.ok) applySnapshot(r.value, 'snapshot');
    });
    emit();
  });
  sock.on('disconnect', () => {
    if (session !== s) return;
    counts.socketDisconnects += 1;
    s.socketDownSinceMs = Date.now();
    log('socket', { connected: false });
    emit();
  });
  sock.on('connect_error', () => {
    if (session === s && s.socketDownSinceMs === null) s.socketDownSinceMs = Date.now();
  });
  sock.on('offer', (o: Offer) => {
    if (session === s) handleOffer(cfg, o, 'socket');
  });
  sock.on('presence', (snap: Snapshot) => {
    if (session !== s) return;
    applySnapshot(snap, null);
    // The server saw no liveness for T_stale. If no location callback arrives (provider off, permission gone), this
    // pushed message is the only thing that runs JS in the background, so it triggers the permission/provider check.
    if (snap.presence === 'STALE' && snap.runId === s.runId) void tick('server');
  });
}

function handleOffer(cfg: ReceiverConfig, o: Offer, channel: OfferChannel): void {
  if (ackedOffers.has(o.offerId)) return;
  ackedOffers.add(o.offerId);
  const clientRecvDeviceMs = Date.now();
  if (channel === 'socket') counts.offersSocket += 1;
  else if (channel === 'poll') counts.offersPoll += 1;
  else counts.offersSnapshot += 1;
  log('offer', { [channel.toUpperCase()]: true });
  if (channel === 'socket' && socket?.connected) socket.emit('offer_ack', { offerId: o.offerId, clientRecvDeviceMs });
  else void api.ack(cfg, [{ offerId: o.offerId, channel, clientRecvDeviceMs }]);
}

function applySnapshot(snap: Snapshot, offerChannel: OfferChannel | null): void {
  server = snap;
  serverAtMs = Date.now();
  counts.snapshots += 1;
  const s = session;
  if (s && (snap.presence === 'OFFLINE' || snap.runId !== s.runId)) {
    void applyServerOffline(snap.presence === 'OFFLINE' ? snap.offlineReason : 'USER_OFFLINE', offerChannel ?? 'presence');
    return;
  }
  const cfg = config;
  if (s && cfg) for (const o of snap.pendingOffers) handleOffer(cfg, o, offerChannel ?? 'snapshot');
  emit();
}

// ---------------------------------------------------------------------------------------------------------------
// Battery, debug controls

async function refreshBattery(force: boolean): Promise<void> {
  if (!force && Date.now() - battery.readMs < BATTERY_EVERY_MS) return;
  const [level, low, optimised] = await Promise.all([
    Battery.getBatteryLevelAsync(),
    Battery.isLowPowerModeEnabledAsync(),
    Platform.OS === 'android' ? Battery.isBatteryOptimizationEnabledAsync() : Promise.resolve(null),
  ]);
  battery = { pct: level >= 0 ? Math.round(level * 100) : null, powerSave: low, optimised, readMs: Date.now() };
}

/** Opens the standard Android "ignore battery optimisations" dialog for this spike (STD-EXEMPT config). */
export async function requestBatteryExemption(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, { data: `package:${SPIKE_PACKAGE}` });
  await refreshBattery(true);
  emit();
}

/**
 * TC-10: schedules a go-online attempt `delayMs` later WITHOUT a JS timer (timers pause in the background): the
 * receiver answers GET /delay after the delay and the response callback runs the attempt. The founder presses Home
 * right away. 30 s is the protocol value; the 5 s variant exists for OS versions whose cached-app freezer holds the
 * response until the app returns to the foreground (then the attempt is recorded as invalid, not as a pass).
 */
export async function armBackgroundGoOnline(delayMs: 30_000 | 5_000 = 30_000): Promise<void> {
  const cfg = config;
  if (!cfg || session || mode !== 'driver') return;
  tc10Armed = true;
  emit();
  log('tc10_armed', { delayMs });
  const r = await api.delay(cfg, delayMs);
  tc10Armed = false;
  if (!r.ok) {
    await setNotice('tc10-invalid', r.code);
    return;
  }
  const appStateAtAttempt = AppState.currentState;
  const outcome = await goOnline('tc10-background');
  if (appStateAtAttempt === 'active') await setNotice('tc10-invalid', 'APP_WAS_IN_FOREGROUND');
  else if (outcome.ok) await setNotice('background-start-refused', 'STARTED_FROM_BACKGROUND');
  emit();
}

/** TC-15(a): an unhandled JS error (release builds terminate the process). */
export async function crashJs(): Promise<void> {
  await queueEvent('CRASH_TEST_TRIGGERED', 'JS', session?.runId);
  await flushEvents(true);
  setTimeout(() => {
    throw new Error('SP-01 TC-15 deliberate unhandled JS error');
  }, 0);
}

export function getStatus(): EngineStatus {
  const now = Date.now();
  const s = session;
  return {
    ready,
    signedIn: config !== null,
    receiver: config ? config.baseUrl : null,
    mode,
    profile,
    online: s !== null,
    runId: s?.runId ?? null,
    fgsRegistered,
    socket: !s ? 'off' : socket?.connected ? 'connected' : 'down',
    socketDownS: s?.socketDownSinceMs ? Math.round((now - s.socketDownSinceMs) / 1000) : null,
    lastUploadAgoS: s && s.lastUploadOkMs ? Math.round((now - s.lastUploadOkMs) / 1000) : null,
    lastFixAgoS: s && s.lastFixMs ? Math.round((now - s.lastFixMs) / 1000) : null,
    bufferDepth: s?.buffer.size ?? 0,
    bufferDrops: s?.buffer.drops ?? 0,
    uploadFailures: s?.uploadFailures ?? 0,
    server: server
      ? { presence: server.presence, reason: server.offlineReason, restricted: server.restricted, ageS: Math.round((now - serverAtMs) / 1000) }
      : null,
    counts: { ...counts },
    notice,
    batteryPct: battery.pct,
    powerSave: battery.powerSave,
    batteryOptimised: battery.optimised,
    tc10Armed,
  };
}
