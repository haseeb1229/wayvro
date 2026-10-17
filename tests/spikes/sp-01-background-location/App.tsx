/**
 * SP-01 spike UI (protocol §5.1). Deliberately plain: it exists to drive the measurement, not to preview Wayvro's
 * design. Every state shown comes from the engine; the engine takes authority from the receiver snapshot.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { copy } from './src/client/copy.ts';
import * as engine from './src/client/engine.ts';
import { isReadyToGoOnline, requestBackground, requestForeground, requestNotifications } from './src/client/permissions.ts';

type Flow = { kind: 'none' } | { kind: 'rationale' } | { kind: 'background' } | { kind: 'recovery'; code: string };

let cachedStatus = engine.getStatus();
const subscribe = (cb: () => void): (() => void) =>
  engine.subscribe(() => {
    cachedStatus = engine.getStatus();
    cb();
  });
const getSnapshot = (): engine.EngineStatus => cachedStatus;

function Button({
  label,
  onPress,
  disabled,
  kind = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[kind], disabled ? styles.disabled : null, pressed ? styles.pressed : null]}
    >
      <Text style={kind === 'secondary' ? styles.buttonTextDark : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

const Row = ({ k, v }: { k: string; v: string | number | boolean | null }) => (
  <View style={styles.row}>
    <Text style={styles.rowKey}>{k}</Text>
    <Text style={styles.rowValue}>{v === null ? '—' : String(v)}</Text>
  </View>
);

export default function App() {
  const status = useSyncExternalStore(subscribe, getSnapshot);
  const [flow, setFlow] = useState<Flow>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [resume, setResume] = useState(false);

  useEffect(() => {
    engine.init().catch((e: unknown) => setInitError(e instanceof Error ? e.name : 'INIT_FAILED'));
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void engine.tick('ui');
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const run = (fn: () => Promise<void>) => () => {
    setBusy(true);
    fn().finally(() => setBusy(false));
  };

  const finishGoOnline = async (): Promise<void> => {
    await requestNotifications();
    const outcome = await engine.goOnline(resume ? 'resume' : 'user');
    setResume(false);
    setFlow(outcome.ok ? { kind: 'none' } : { kind: 'recovery', code: outcome.refusal });
  };

  const afterForeground = async (): Promise<void> => {
    const p = await requestForeground();
    if (p.foreground !== 'granted') return setFlow({ kind: 'recovery', code: 'FOREGROUND_PERMISSION_DENIED' });
    if (!p.precise) return setFlow({ kind: 'recovery', code: 'PRECISE_LOCATION_REQUIRED' });
    if (p.background !== 'granted') return setFlow({ kind: 'background' });
    if (!isReadyToGoOnline(p)) return setFlow({ kind: 'recovery', code: 'LOCATION_SERVICES_OFF' });
    return finishGoOnline();
  };

  const afterBackground = async (): Promise<void> => {
    const p = await requestBackground();
    if (p.background !== 'granted') return setFlow({ kind: 'recovery', code: 'BACKGROUND_PERMISSION_DENIED' });
    if (!isReadyToGoOnline(p)) return setFlow({ kind: 'recovery', code: p.precise ? 'LOCATION_SERVICES_OFF' : 'PRECISE_LOCATION_REQUIRED' });
    return finishGoOnline();
  };

  const switchMode = (next: 'rider' | 'driver'): void => {
    if (next === 'rider' && status.online) {
      Alert.alert(copy.confirmRider.title, copy.confirmRider.body, [
        { text: copy.confirmRider.cancel, style: 'cancel' },
        {
          text: copy.confirmRider.confirm,
          style: 'destructive',
          onPress: run(async () => {
            await engine.goOffline('USER_OFFLINE');
            await engine.setMode('rider');
          }),
        },
      ]);
      return;
    }
    void engine.setMode(next);
  };

  const confirmSignOut = (): void =>
    Alert.alert(copy.signOut.title, copy.signOut.body, [
      { text: copy.signOut.cancel, style: 'cancel' },
      { text: copy.signOut.confirm, style: 'destructive', onPress: run(() => engine.signOut()) },
    ]);

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{copy.appTitle}</Text>
      <Text style={styles.warning}>{copy.notForDistribution}</Text>
    </View>
  );

  let body: ReactNode;
  if (initError) {
    body = <Text style={styles.error}>INIT_FAILED {initError}</Text>;
  } else if (!status.ready) {
    body = <Text>…</Text>;
  } else if (!status.signedIn) {
    body = (
      <Section title={copy.signIn.title}>
        <Text style={styles.p}>{copy.signIn.help}</Text>
        <TextInput
          accessibilityLabel={copy.signIn.url}
          placeholder={copy.signIn.url}
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel={copy.signIn.token}
          placeholder={copy.signIn.token}
          autoCapitalize="none"
          autoCorrect={false}
          value={token}
          onChangeText={setToken}
          style={styles.input}
        />
        {signInError ? <Text style={styles.error}>{copy.signIn.errors[signInError] ?? signInError}</Text> : null}
        <Button
          label={copy.signIn.submit}
          disabled={busy}
          onPress={run(async () => {
            const r = await engine.signIn(url, token);
            setSignInError(r === 'ok' ? null : r);
          })}
        />
      </Section>
    );
  } else if (flow.kind === 'rationale') {
    body = (
      <Section title={copy.disclosure.title}>
        <Text style={styles.p}>{copy.disclosure.body}</Text>
        <Button label={copy.disclosure.continue} disabled={busy} onPress={run(afterForeground)} />
        <Button label={copy.disclosure.notNow} kind="secondary" onPress={() => setFlow({ kind: 'none' })} />
      </Section>
    );
  } else if (flow.kind === 'background') {
    body = (
      <Section title={copy.background.title}>
        <Text style={styles.p}>{copy.background.body}</Text>
        <Button label={copy.background.open} disabled={busy} onPress={run(afterBackground)} />
        <Button label={copy.background.notNow} kind="secondary" onPress={() => setFlow({ kind: 'none' })} />
      </Section>
    );
  } else if (flow.kind === 'recovery') {
    body = (
      <Section>
        <Text style={styles.p}>{copy.recovery[flow.code] ?? flow.code}</Text>
        <Button label={copy.recovery['openSettings'] ?? 'Settings'} onPress={() => void Linking.openSettings()} />
        <Button label={copy.recovery['back'] ?? 'Back'} kind="secondary" onPress={() => setFlow({ kind: 'none' })} />
      </Section>
    );
  } else {
    const n = status.notice;
    body = (
      <>
        {n ? (
          <Section>
            <Text style={styles.notice}>
              {copy.notices[n.kind]} {n.kind === 'tracking-stopped' ? '' : n.code}
            </Text>
            {n.kind === 'tracking-stopped' && status.mode === 'driver' ? (
              <>
                <Button
                  label={copy.notices.resume}
                  disabled={busy}
                  onPress={() => {
                    setResume(true);
                    setFlow({ kind: 'rationale' });
                  }}
                />
                <Button label={copy.notices.goOffline} kind="secondary" disabled={busy} onPress={run(() => engine.stayOffline())} />
              </>
            ) : n.kind === 'permission-lost' ? (
              <>
                <Button label={copy.recovery['openSettings'] ?? 'Settings'} onPress={() => void Linking.openSettings()} />
                <Button label={copy.notices.dismiss} kind="secondary" onPress={() => void engine.clearNotice()} />
              </>
            ) : (
              <Button label={copy.notices.dismiss} kind="secondary" onPress={() => void engine.clearNotice()} />
            )}
          </Section>
        ) : null}
        <Section>
          <View style={styles.toggle}>
            <Button label={copy.modes.rider} kind={status.mode === 'rider' ? 'primary' : 'secondary'} disabled={busy} onPress={() => switchMode('rider')} />
            <Button label={copy.modes.driver} kind={status.mode === 'driver' ? 'primary' : 'secondary'} disabled={busy} onPress={() => switchMode('driver')} />
          </View>
        </Section>
        {status.mode === 'rider' ? (
          <Section>
            <Text style={styles.p}>{copy.riderMode}</Text>
          </Section>
        ) : (
          <>
            <Section>
              {status.online ? (
                <Button label={copy.driver.goOffline} kind="danger" disabled={busy} onPress={run(() => engine.goOffline('USER_OFFLINE'))} />
              ) : (
                <Button label={copy.driver.goOnline} disabled={busy || status.tc10Armed} onPress={() => setFlow({ kind: 'rationale' })} />
              )}
            </Section>
            <Section title="Status">
              <Row k="online (this process)" v={status.online} />
              <Row k="FGS registered" v={status.fgsRegistered} />
              <Row k="server presence" v={status.server ? `${status.server.presence}${status.server.reason ? ` (${status.server.reason})` : ''}` : null} />
              <Row k="restricted" v={status.server?.restricted ?? null} />
              <Row k="socket" v={`${status.socket}${status.socketDownS !== null ? ` ${String(status.socketDownS)} s` : ''}`} />
              <Row k="last fix (s ago)" v={status.lastFixAgoS} />
              <Row k="last upload (s ago)" v={status.lastUploadAgoS} />
              <Row k="buffer depth / drops" v={`${String(status.bufferDepth)} / ${String(status.bufferDrops)}`} />
              <Row k="upload failures (current streak)" v={status.uploadFailures} />
              <Row k="fixes / after stop" v={`${String(status.counts.fixes)} / ${String(status.counts.fixesAfterStop)}`} />
              <Row
                k="uploads ok / failed / rejected"
                v={`${String(status.counts.uploadsOk)} / ${String(status.counts.uploadsFailed)} / ${String(status.counts.uploadsRejected)}`}
              />
              <Row
                k="offers socket / poll / snapshot"
                v={`${String(status.counts.offersSocket)} / ${String(status.counts.offersPoll)} / ${String(status.counts.offersSnapshot)}`}
              />
              <Row k="socket connects / disconnects" v={`${String(status.counts.socketConnects)} / ${String(status.counts.socketDisconnects)}`} />
              <Row k="orphan task stops" v={status.counts.orphanStops} />
              <Row
                k="battery % / saver / optimised"
                v={`${String(status.batteryPct ?? '—')} / ${String(status.powerSave ?? '—')} / ${String(status.batteryOptimised ?? '—')}`}
              />
              <Row k="run" v={status.runId} />
            </Section>
            <Section title={copy.driver.profile}>
              <View style={styles.toggle}>
                <Button
                  label={copy.driver.standard}
                  kind={status.profile === 'standard' ? 'primary' : 'secondary'}
                  disabled={status.online}
                  onPress={() => void engine.setProfile('standard')}
                />
                <Button
                  label={copy.driver.economy}
                  kind={status.profile === 'economy' ? 'primary' : 'secondary'}
                  disabled={status.online}
                  onPress={() => void engine.setProfile('economy')}
                />
              </View>
              <Button label={copy.driver.battery} kind="secondary" onPress={run(() => engine.requestBatteryExemption())} />
            </Section>
            <Section title={copy.debug.title}>
              <Button
                label={status.tc10Armed ? copy.debug.tc10Armed : copy.debug.tc10}
                kind="secondary"
                disabled={status.online || status.tc10Armed}
                onPress={() => void engine.armBackgroundGoOnline(30_000)}
              />
              <Button
                label={copy.debug.tc10Short}
                kind="secondary"
                disabled={status.online || status.tc10Armed}
                onPress={() => void engine.armBackgroundGoOnline(5_000)}
              />
              <Button label={copy.debug.tc15} kind="danger" onPress={() => void engine.crashJs()} />
            </Section>
          </>
        )}
        <Section>
          <Text style={styles.small}>receiver {status.receiver ?? '—'}</Text>
          <Button label={copy.signOut.button} kind="secondary" disabled={busy} onPress={confirmSignOut} />
        </Section>
      </>
    );
  }

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {header}
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f7f5' },
  scroll: { padding: 16, paddingTop: 40, gap: 12 },
  header: { gap: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#1b1b1b' },
  warning: { fontSize: 14, color: '#8a3b00' },
  section: { backgroundColor: '#ffffff', borderRadius: 8, padding: 12, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1b1b1b' },
  p: { fontSize: 15, lineHeight: 21, color: '#1b1b1b' },
  small: { fontSize: 12, color: '#555555' },
  notice: { fontSize: 15, fontWeight: '600', color: '#7a1f00' },
  error: { fontSize: 14, color: '#a40000' },
  input: { borderWidth: 1, borderColor: '#bdbdbd', borderRadius: 6, paddingHorizontal: 10, minHeight: 48, fontSize: 15, color: '#1b1b1b' },
  toggle: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  rowKey: { fontSize: 13, color: '#555555', flexShrink: 1 },
  rowValue: { fontSize: 13, color: '#1b1b1b', fontVariant: ['tabular-nums'] },
  button: { minHeight: 48, borderRadius: 6, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', flexGrow: 1 },
  primary: { backgroundColor: '#0b5a4a' },
  secondary: { backgroundColor: '#e7e7e3' },
  danger: { backgroundColor: '#9b1c1c' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  buttonTextDark: { color: '#1b1b1b', fontSize: 15, fontWeight: '600' },
});
