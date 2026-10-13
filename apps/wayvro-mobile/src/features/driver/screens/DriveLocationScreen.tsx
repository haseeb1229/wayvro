import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Section } from '../../../core/ui/components';
import { Body, Screen, Title, TranslationPendingNote } from '../../../core/ui/primitives';
import { readLocationStatus } from '../../../platform/location/status';
import type { DriverStringKey } from '../i18n/driver-strings';
import { useDriverText } from '../ui/DriverUi';

/**
 * Location rationale for driving `/drive/location` (lazy; A07 informational, INV-07). It explains the later need
 * (online-only tracking, "Allow all the time", battery, privacy) and shows the current foreground setting READ-ONLY.
 * Nothing is requested here in Phase 3 — no OS dialog can appear from the Driver/Partner area.
 */
export default function DriveLocationScreen() {
  const dt = useDriverText();
  const [statusKey, setStatusKey] = useState<DriverStringKey>('drive.location.statusUnknown');
  useEffect(() => {
    let active = true;
    readLocationStatus().then(
      (snapshot) => {
        if (active) setStatusKey(snapshot.status === 'granted' ? 'drive.location.statusAllowed' : 'drive.location.statusNotYet');
      },
      () => {
        // Unreadable status: the "couldn't be read" line stays.
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('drive.location.title') }} />
      <Title>{dt('drive.location.title')}</Title>
      <Body>{dt('drive.location.now')}</Body>
      <Body muted>{dt(statusKey)}</Body>
      <Section title={dt('drive.location.laterTitle')}>
        <Body>{dt('drive.location.later')}</Body>
      </Section>
      <Section title={dt('drive.location.batteryTitle')}>
        <Body>{dt('drive.location.battery')}</Body>
      </Section>
      <Section title={dt('drive.location.privacyTitle')}>
        <Body>{dt('drive.location.privacy')}</Body>
      </Section>
      <TranslationPendingNote />
    </Screen>
  );
}
