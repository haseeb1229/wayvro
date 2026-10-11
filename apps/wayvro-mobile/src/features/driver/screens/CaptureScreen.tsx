import { EVIDENCE_KIND_VALUES } from '@wayvro/contracts';
import { useMutation } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, Heading, Screen, Title } from '../../../core/ui/primitives';
import { colors, MIN_TOUCH_TARGET, spacing } from '../../../core/ui/tokens';
import { randomBytes } from '../../../core/platform/crypto';
import type { CaptureChallenge } from '../api/driver-api';
import { importDocumentPhoto, queueAdopted } from '../capture/add-photo';
import { CAMERA_JPEG_QUALITY, cameraAccessFrom, captureOptionsFor, deniedOptions, photoRefusalKey } from '../capture/capture-rules';
import type { DriverStringKey } from '../i18n/driver-strings';
import { adoptCapture, deleteEvidenceFile, evidenceFileUri, type Adopted } from '../upload/evidence-files';
import type { EvidenceKind } from '../upload/upload-queue';
import { useDriverApi, useUploadQueue } from '../upload/upload-service';
import { driverErrorView } from '../ui/driver-errors';
import { DriverErrorBanner, InfoSection, useDriverText } from '../ui/DriverUi';

/**
 * Guided capture (K02/K03). The camera permission is requested ONLY here, after the user chose "Take photo", with an
 * explanation first; the camera runs only while this screen is open. Documents use the back camera with a framing
 * outline and simple tips (no detection, no ML); the selfie uses the FRONT camera only — there is no import option for
 * it — with an optional, accessible action that can always be declined. A denied permission never dead-ends: documents
 * can be imported through the system picker instead, and the in-person alternative is explained for the selfie.
 */
const ParamsSchema = z.object({ application: z.uuid(), document: z.uuid(), kind: z.enum(EVIDENCE_KIND_VALUES) });

export default function CaptureScreen() {
  const dt = useDriverText();
  const params = ParamsSchema.safeParse(useLocalSearchParams());
  if (!params.success) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('capture.titleDocument') }} />
        <Banner tone="error" text={dt('capture.invalidLink')} />
      </Screen>
    );
  }
  return <Capture applicationId={params.data.application} documentId={params.data.document} kind={params.data.kind} />;
}

type Adoption = Extract<Adopted, { ok: true }>;

function Capture({ applicationId, documentId, kind }: { readonly applicationId: string; readonly documentId: string; readonly kind: EvidenceKind }) {
  const dt = useDriverText();
  const router = useRouter();
  const { runner } = useUploadQueue();
  const selfie = kind === 'SELFIE_FOR_MANUAL_REVIEW';
  const options = captureOptionsFor(kind);
  const title = dt(selfie ? 'capture.titleSelfie' : 'capture.titleDocument');
  const target = { applicationId, documentId, kind };

  const { clock } = useServices();
  // Reads the current status on open (no prompt); the OS prompt appears only when the user taps "Allow camera".
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<DriverStringKey | null>(null);
  const [photo, setPhoto] = useState<Adoption | null>(null);
  const [challenge, setChallenge] = useState<CaptureChallenge | null>(null);
  const camera = useRef<CameraView>(null);
  // An adopted photo the user did not keep is deleted when the screen closes (Q01).
  const pending = useRef<Adoption | null>(null);
  useEffect(() => {
    pending.current = photo;
  }, [photo]);
  useEffect(
    () => () => {
      if (pending.current !== null) deleteEvidenceFile(pending.current.fileName);
    },
    [],
  );

  const access = cameraAccessFrom(permission, asked);
  const denied = deniedOptions(kind, access);

  const ask = () => {
    setAsked(true);
    void requestPermission();
  };

  const shoot = async () => {
    const view = camera.current;
    if (view === null) return;
    setBusy(true);
    setNotice(null);
    try {
      await runner.start();
      const picture = await view.takePictureAsync({ quality: CAMERA_JPEG_QUALITY, exif: false, base64: false, shutterSound: false });
      const adopted = await adoptCapture(picture.uri, randomBytes);
      if (adopted.ok) setPhoto(adopted);
      else setNotice(photoRefusalKey(adopted.reason));
    } catch {
      setNotice('evidence.local.unreadable');
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    if (photo !== null) deleteEvidenceFile(photo.fileName);
    setPhoto(null);
  };

  const use = useMutation({
    mutationFn: async (adopted: Adoption) => {
      const live = challenge !== null && Date.parse(challenge.expiresAt) > Date.now() + clock.offsetMs ? challenge.challengeId : null;
      return queueAdopted(runner, target, adopted, 'IN_APP_CAMERA', selfie ? live : null);
    },
    onSuccess: (result) => {
      // The file now belongs to the queue (or was deleted on refusal): it must not be deleted again on close.
      pending.current = null;
      setPhoto(null);
      if (result.ok) router.back();
      else setNotice(photoRefusalKey(result.reason));
    },
  });

  const importInstead = useMutation({
    mutationFn: () => importDocumentPhoto(runner, target),
    onSuccess: (result) => {
      if (result === null) return;
      if (result.ok) router.back();
      else setNotice(photoRefusalKey(result.reason));
    },
  });

  if (photo !== null) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Title>{dt('capture.preview')}</Title>
        <Image source={{ uri: evidenceFileUri(photo.fileName) }} style={styles.preview} resizeMode="contain" accessibilityLabel={dt('capture.preview')} />
        {notice === null ? null : <Banner tone="warning" text={dt(notice)} />}
        <DriverErrorBanner error={use.error === null ? null : driverErrorView(use.error)} />
        <Button
          label={dt('capture.use')}
          busy={use.isPending}
          onPress={() => {
            use.mutate(photo);
          }}
        />
        <Button variant="secondary" label={dt('capture.retake')} onPress={retake} />
      </Screen>
    );
  }

  if (access === 'granted' && !cameraError) {
    return (
      <View style={styles.cameraScreen}>
        <Stack.Screen options={{ title }} />
        <CameraView
          ref={camera}
          style={styles.camera}
          facing={options.camera}
          mode="picture"
          mute
          animateShutter={false}
          accessibilityLabel={dt('capture.cameraPreview')}
          onMountError={() => {
            setCameraError(true);
          }}
        />
        <View pointerEvents="none" style={styles.guideLayer}>
          <View style={options.guide === 'face' ? styles.guideFace : options.guide === 'card' ? styles.guideCard : styles.guidePage} />
        </View>
        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panel}>
          <Text style={styles.tip}>
            {dt(options.guide === 'face' ? 'capture.guideFace' : options.guide === 'card' ? 'capture.guideCard' : 'capture.guidePage')}
          </Text>
          <Text style={styles.tip}>{dt('capture.guideLight')}</Text>
          {selfie ? <Text style={styles.tip}>{dt('capture.selfieNote')}</Text> : <Text style={styles.tip}>{dt('capture.guideSteady')}</Text>}
          {selfie ? <ChallengePanel applicationId={applicationId} challenge={challenge} onChallenge={setChallenge} /> : null}
          {notice === null ? null : <Banner tone="warning" text={dt(notice)} />}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? dt('capture.taking') : dt('capture.shutter')}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => {
              void shoot();
            }}
            style={({ pressed }) => [styles.shutter, pressed || busy ? styles.shutterPressed : undefined]}
          >
            <Text style={styles.shutterText}>{busy ? dt('capture.taking') : dt('capture.shutter')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <Title>{title}</Title>
      {cameraError ? <Banner tone="error" text={dt('capture.cameraError')} /> : null}
      {access === 'checking' ? <Body muted>{dt('capture.permissionTitle')}</Body> : null}
      {access === 'undetermined' ? (
        <>
          <Heading>{dt('capture.permissionTitle')}</Heading>
          <Body>{dt(selfie ? 'capture.permissionBodySelfie' : 'capture.permissionBody')}</Body>
          <Button label={dt('capture.allow')} onPress={ask} />
        </>
      ) : null}
      {denied === null ? null : (
        <>
          <Banner
            tone="warning"
            text={dt(
              selfie
                ? denied.openSettings
                  ? 'capture.blockedSelfie'
                  : 'capture.deniedSelfie'
                : denied.openSettings
                  ? 'capture.blockedDocument'
                  : 'capture.deniedDocument',
            )}
          />
          {denied.askAgain ? <Button label={dt('capture.allow')} onPress={ask} /> : null}
          {denied.openSettings ? (
            <Button
              label={dt('capture.openSettings')}
              onPress={() => {
                void Linking.openSettings();
              }}
            />
          ) : null}
          {denied.importInstead ? (
            <Button
              variant="secondary"
              label={dt('evidence.choosePhoto')}
              busy={importInstead.isPending}
              onPress={() => {
                importInstead.mutate();
              }}
            />
          ) : null}
          {denied.inPersonInstead ? <InfoSection title="capture.inPersonTitle" body="capture.inPersonBody" /> : null}
        </>
      )}
      {cameraError && options.allowImport ? (
        <Button
          variant="secondary"
          label={dt('evidence.choosePhoto')}
          busy={importInstead.isPending}
          onPress={() => {
            importInstead.mutate();
          }}
        />
      ) : null}
      {cameraError ? (
        <Button
          variant="secondary"
          label={dt('evidence.retry')}
          onPress={() => {
            setCameraError(false);
          }}
        />
      ) : null}
      {notice === null ? null : <Banner tone="warning" text={dt(notice)} />}
      <DriverErrorBanner error={importInstead.error === null ? null : driverErrorView(importInstead.error)} />
    </Screen>
  );
}

/** Optional accessible selfie action: never required, "I can't do this one" replaces it, "None of these work" declines. */
function ChallengePanel(props: {
  readonly applicationId: string;
  readonly challenge: CaptureChallenge | null;
  readonly onChallenge: (next: CaptureChallenge | null) => void;
}) {
  const dt = useDriverText();
  const api = useDriverApi();
  const { clock } = useServices();
  const [declined, setDeclined] = useState(false);
  const [expiredId, setExpiredId] = useState<string | null>(null);
  // The server's expiry (device clock corrected by the server offset) marks the action as expired in the UI.
  useEffect(() => {
    const current = props.challenge;
    if (current === null) return undefined;
    const timer = setTimeout(
      () => {
        setExpiredId(current.challengeId);
      },
      Math.max(0, Date.parse(current.expiresAt) - (Date.now() + clock.offsetMs)),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [props.challenge, clock]);
  const issue = useMutation({ mutationFn: () => api.createCaptureChallenge(props.applicationId), onSuccess: props.onChallenge });
  const decline = useMutation({
    mutationFn: (args: { challengeId: string; choice: 'REPLACE' | 'NONE_ACCESSIBLE' }) =>
      api.declineCaptureChallenge(props.applicationId, args.challengeId, args.choice),
    onSuccess: (result) => {
      props.onChallenge(result.replacement);
      setDeclined(result.replacement === null);
    },
  });
  const error = issue.error ?? decline.error;
  const { challenge } = props;
  const expired = challenge !== null && expiredId === challenge.challengeId;

  if (declined) return <Text style={styles.tip}>{dt('challenge.declined')}</Text>;
  return (
    <View style={styles.challenge}>
      <Text style={styles.challengeTitle} accessibilityRole="header">
        {dt('challenge.title')}
      </Text>
      {challenge === null ? (
        <>
          <Text style={styles.tip}>{dt('challenge.body')}</Text>
          <Button
            variant="secondary"
            label={dt('challenge.get')}
            busy={issue.isPending}
            onPress={() => {
              issue.mutate();
            }}
          />
        </>
      ) : (
        <>
          <Text style={styles.tip} accessibilityLiveRegion="polite">
            {expired ? dt('challenge.expired') : dt('challenge.current', { action: dt(`challenge.code.${challenge.challengeCode}`) })}
          </Text>
          <Button
            variant="secondary"
            label={dt('challenge.cantDo')}
            busy={decline.isPending}
            onPress={() => {
              decline.mutate({ challengeId: challenge.challengeId, choice: 'REPLACE' });
            }}
          />
          <Button
            variant="secondary"
            label={dt('challenge.noneWork')}
            busy={decline.isPending}
            onPress={() => {
              decline.mutate({ challengeId: challenge.challengeId, choice: 'NONE_ACCESSIBLE' });
            }}
          />
        </>
      )}
      <DriverErrorBanner error={error === null ? null : driverErrorView(error)} />
    </View>
  );
}

const styles = StyleSheet.create({
  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  camera: { flex: 1 },
  guideLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: '40%', alignItems: 'center', justifyContent: 'center' },
  guideCard: { width: '86%', aspectRatio: 1.586, borderWidth: 3, borderColor: colors.onPrimary, borderRadius: 12 },
  guidePage: { width: '80%', aspectRatio: 0.707, borderWidth: 3, borderColor: colors.onPrimary, borderRadius: 8 },
  guideFace: { width: '60%', aspectRatio: 0.78, borderWidth: 3, borderColor: colors.onPrimary, borderRadius: 999 },
  panelScroll: { maxHeight: '50%', backgroundColor: colors.background },
  panel: { padding: spacing.lg, gap: spacing.sm },
  tip: { fontSize: 16, lineHeight: 22, color: colors.text },
  challenge: { gap: spacing.sm, paddingVertical: spacing.sm },
  challengeTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  shutter: {
    minHeight: MIN_TOUCH_TARGET + 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { opacity: 0.7 },
  shutterText: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },
  preview: { width: '100%', aspectRatio: 0.75, backgroundColor: colors.surface },
});
