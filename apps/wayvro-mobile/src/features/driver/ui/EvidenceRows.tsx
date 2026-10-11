import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '../../../core/api/errors';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { confirmDestructive } from '../../../core/ui/confirm';
import { Banner, Body, Button, Heading } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { importDocumentPhoto } from '../capture/add-photo';
import { captureOptionsFor, photoRefusalKey } from '../capture/capture-rules';
import type { DriverStringKey } from '../i18n/driver-strings';
import type { EvidenceDisplay, EvidenceSlotView } from '../onboarding/checklist';
import { useDriverApi, useUploadQueue } from '../upload/upload-service';
import { driverErrorView } from './driver-errors';
import { DriverErrorBanner, useDriverText } from './DriverUi';

/**
 * Photos of one claimed document: status per evidence kind and the actions that make sense for it — camera capture,
 * a controlled import (documents only, never the selfie), retry, check again and remove. Statuses come from the
 * server's evidence list plus the local upload queue.
 */
export function EvidenceRows(props: {
  readonly applicationId: string;
  readonly documentId: string;
  readonly slots: readonly EvidenceSlotView[];
  /** Server copies can be discarded only while the application is editable (not for renewals of a verified driver). */
  readonly allowServerRemove: boolean;
  readonly onServerChange: () => void;
}) {
  return (
    <View style={styles.list}>
      {props.slots.map((slot) => (
        <EvidenceRow key={slot.kind} {...props} slot={slot} />
      ))}
    </View>
  );
}

function stateKey(display: EvidenceDisplay): DriverStringKey {
  return `evidence.state.${display.state}`;
}

function EvidenceRow(props: {
  readonly applicationId: string;
  readonly documentId: string;
  readonly slot: EvidenceSlotView;
  readonly allowServerRemove: boolean;
  readonly onServerChange: () => void;
}) {
  const dt = useDriverText();
  const { t } = useI18n();
  const router = useRouter();
  const api = useDriverApi();
  const { runner } = useUploadQueue();
  const [notice, setNotice] = useState<DriverStringKey | null>(null);
  const { slot } = props;
  const { display } = slot;
  const options = captureOptionsFor(slot.kind);
  const target = { applicationId: props.applicationId, documentId: props.documentId, kind: slot.kind };

  const importPhoto = useMutation({
    mutationFn: () => importDocumentPhoto(runner, target),
    onSuccess: (result) => {
      setNotice(result === null ? null : result.ok ? 'evidence.added' : photoRefusalKey(result.reason));
    },
  });
  const removeServer = useMutation({
    mutationFn: (uploadId: string) => api.discardEvidenceUpload(uploadId),
    onSuccess: props.onServerChange,
  });

  const confirmRemove = (action: () => void) => {
    void confirmDestructive({
      title: dt('evidence.removeConfirmTitle'),
      body: dt('evidence.removeConfirmBody'),
      confirm: dt('evidence.remove'),
      cancel: t('common.cancel'),
    }).then((confirmed) => {
      if (confirmed) action();
    });
  };

  const capture = (
    <>
      <Button
        label={dt(slot.kind === 'SELFIE_FOR_MANUAL_REVIEW' ? 'evidence.takeSelfie' : 'evidence.takePhoto')}
        onPress={() => {
          setNotice(null);
          router.push({ pathname: '/earn/capture', params: { application: props.applicationId, document: props.documentId, kind: slot.kind } });
        }}
      />
      {options.allowImport ? (
        <>
          <Button
            variant="secondary"
            label={dt('evidence.choosePhoto')}
            busy={importPhoto.isPending}
            onPress={() => {
              setNotice(null);
              importPhoto.mutate();
            }}
          />
          <Body muted>{dt('evidence.importNote')}</Body>
        </>
      ) : null}
    </>
  );

  const localRemove = (localId: string) => (
    <Button
      variant="secondary"
      label={dt('evidence.remove')}
      onPress={() => {
        confirmRemove(() => {
          void runner.remove(localId).then((outcome) => {
            setNotice(outcome === 'removed' ? null : outcome === 'offline' ? 'evidence.removeOffline' : 'evidence.fail.unknown');
          });
        });
      }}
    />
  );

  return (
    <View style={styles.row} accessibilityRole="summary">
      <Heading>{dt(`evidence.${slot.kind}`)}</Heading>
      <Body muted>{dt(stateKey(display))}</Body>
      {display.state === 'rejected' ? <Banner tone="warning" text={dt(`evidence.reject.${display.rejection}`)} /> : null}
      {display.state === 'failed' ? <Banner tone="error" text={dt(`evidence.fail.${display.failure}`)} /> : null}
      {notice === null ? null : <Banner tone={notice === 'evidence.added' ? 'info' : 'warning'} text={dt(notice)} />}
      <DriverErrorBanner error={importPhoto.error === null ? null : driverErrorView(importPhoto.error)} />
      {removeServer.error === null ? null : (
        <Banner tone="error" text={dt(toApiError(removeServer.error).detail.transient ? 'evidence.removeOffline' : 'evidence.fail.unknown')} />
      )}
      {display.state === 'none' || display.state === 'rejected' ? capture : null}
      {display.state === 'failed' ? (
        <>
          {display.canRetry ? (
            <Button
              label={dt('evidence.retry')}
              onPress={() => {
                void runner.retry(display.localId);
              }}
            />
          ) : (
            capture
          )}
          {localRemove(display.localId)}
        </>
      ) : null}
      {display.state === 'queued' || display.state === 'uploading' ? localRemove(display.localId) : null}
      {display.state === 'processing' ? (
        <Button
          variant="secondary"
          label={dt('evidence.checkAgain')}
          onPress={() => {
            void runner.retry(display.localId);
            props.onServerChange();
          }}
        />
      ) : null}
      {display.state === 'accepted' && props.allowServerRemove ? (
        <Button
          variant="secondary"
          label={dt('evidence.remove')}
          busy={removeServer.isPending}
          onPress={() => {
            confirmRemove(() => {
              removeServer.mutate(display.uploadId);
            });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg },
  row: { gap: spacing.sm },
});
