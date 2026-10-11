import type { DriverCompliance } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { deviceTodayIso } from '../../../core/input/digits';
import { Banner, Body, Button, Heading, Screen, StateView, TextField, Title } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { combineQueries, viewStateFromQuery } from '../../../core/ui/view-state';
import type { DocumentRenewal } from '../api/driver-api';
import { DRIVER_KEYS, useCompliance, useComplianceDistricts, useEvidence } from '../api/driver-queries';
import { renewalAppeal, type RenewalAppealView } from '../compliance/compliance';
import { evidenceDisplay, isEvidenceKind, missingItems } from '../onboarding/checklist';
import { districtName, type District } from '../onboarding/districts';
import { renewalFieldHints } from '../onboarding/field-hints';
import { buildRenewalClaim, emptyDocumentForm, type DocumentForm, type FieldErrors } from '../onboarding/forms';
import { useDriverApi, useUploadQueue } from '../upload/upload-service';
import type { EvidenceKind } from '../upload/upload-queue';
import { driverErrorView, refusalReasonCodes } from '../ui/driver-errors';
import { DateFields, DriverErrorBanner, RenewalAppealNotice, useDriverText } from '../ui/DriverUi';
import { EvidenceRows } from '../ui/EvidenceRows';
import { documentLabel } from '../ui/labels';
import { useQueueRefresh } from '../ui/use-queue-refresh';

/**
 * Document renewal of a verified driver (D03; R02–R06): new claims (the new expiry date is required), then photos for
 * the renewal document through the same upload queue (slots of the driver's application), then submission. A human
 * reviewer decides. A refused renewal can be appealed through the existing appeal flow when the server names an
 * appealable decision, and a new renewal can always be started. The renewal keeps the document's district (the server
 * copies it), so the district is only displayed here.
 */
const ParamsSchema = z.object({ document: z.uuid() });
type DocumentField = 'number' | 'licenceClass' | 'issuedOn' | 'expiresOn';

export default function RenewalScreen() {
  const dt = useDriverText();
  const params = ParamsSchema.safeParse(useLocalSearchParams());
  const compliance = useCompliance();
  const districts = useComplianceDistricts(compliance.data);
  if (!params.success) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('compliance.renew') }} />
        <Banner tone="error" text={dt('renewal.invalidLink')} />
      </Screen>
    );
  }
  const view = viewStateFromQuery(compliance, (c) => ({ compliance: c, doc: c.documents.find((d) => d.id === params.data.document) ?? null }));
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('compliance.renew') }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void compliance.refetch();
          }}
        />
      </Screen>
    );
  }
  const { doc } = view.data;
  if (doc === null) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('compliance.renew') }} />
        <Banner tone="error" text={dt('renewal.invalidLink')} />
      </Screen>
    );
  }
  return <Renewal compliance={view.data.compliance} doc={doc} districts={districts} />;
}

type ComplianceDocument = DriverCompliance['documents'][number];

function Renewal(props: { readonly compliance: DriverCompliance; readonly doc: ComplianceDocument; readonly districts: readonly District[] }) {
  const { compliance, doc } = props;
  const dt = useDriverText();
  const { locale } = useI18n();
  const api = useDriverApi();
  const queryClient = useQueryClient();
  const title = dt('renewal.title', { document: documentLabel(dt, doc.documentType) });
  const hints = renewalFieldHints(doc);
  const [form, setForm] = useState<DocumentForm>(emptyDocumentForm);
  const [errors, setErrors] = useState<FieldErrors<DocumentField>>({});
  const [started, setStarted] = useState<DocumentRenewal | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.compliance });
  const district = doc.districtCode === null ? null : dt('renewal.district', { district: districtName(locale, doc.districtCode, props.districts) });

  const start = useMutation({
    mutationFn: (request: Parameters<typeof api.startRenewal>[1]) => api.startRenewal(doc.id, request),
    onSuccess: async (renewal) => {
      setStarted(renewal);
      await refresh();
    },
  });

  // A DRAFT renewal from the server (or the one just started) continues with photos; REJECTED starts a new one.
  const live = doc.renewal ?? null;
  const renewal =
    started ??
    (live !== null && live.status !== 'REJECTED'
      ? { renewalDocumentId: live.renewalDocumentId, status: live.status, applicationId: compliance.applicationId ?? null, evidenceKinds: live.evidenceKinds }
      : null);
  const appeal = renewalAppeal(live);
  // The appeal belongs to the server's renewal, never to one just started on this screen.
  const evidenceAppeal: RenewalAppealView = started === null ? appeal : { kind: 'none' };

  if (renewal === null) {
    const fieldError = (name: DocumentField) => {
      const key = errors[name];
      return key === undefined ? null : dt(key);
    };
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Title>{title}</Title>
        <Body>{dt('renewal.body')}</Body>
        {district === null ? null : <Body muted>{district}</Body>}
        <RenewalAppealNotice appeal={appeal} />
        {hints.number ? (
          <TextField
            label={dt('claim.number')}
            value={form.number}
            onChangeText={(number) => {
              setForm({ ...form, number });
            }}
            maxLength={40}
            error={fieldError('number')}
          />
        ) : null}
        {hints.licenceClass ? (
          <TextField
            label={dt('claim.licenceClass')}
            value={form.licenceClass}
            onChangeText={(licenceClass) => {
              setForm({ ...form, licenceClass });
            }}
            maxLength={12}
            error={fieldError('licenceClass')}
          />
        ) : null}
        {hints.issuedOn ? (
          <DateFields
            label={dt('claim.issuedOn')}
            value={form.issuedOn}
            onChange={(issuedOn) => {
              setForm({ ...form, issuedOn });
            }}
            error={fieldError('issuedOn')}
          />
        ) : null}
        <DateFields
          label={dt('claim.expiresOn')}
          value={form.expiresOn}
          onChange={(expiresOn) => {
            setForm({ ...form, expiresOn });
          }}
          error={fieldError('expiresOn')}
        />
        <DriverErrorBanner error={start.error === null ? null : driverErrorView(start.error)} />
        <Button
          label={dt('renewal.start')}
          busyLabel={dt('driver.saving')}
          busy={start.isPending}
          onPress={() => {
            const built = buildRenewalClaim(hints, form, deviceTodayIso());
            if (!built.ok) {
              setErrors(built.errors);
              return;
            }
            setErrors({});
            start.mutate(built.request);
          }}
        />
      </Screen>
    );
  }

  // Evidence kinds come only from the server (start response or the compliance view's renewal).
  const kinds = renewal.evidenceKinds.filter(isEvidenceKind);
  return (
    <RenewalEvidence
      title={title}
      applicationId={renewal.applicationId}
      renewalDocumentId={renewal.renewalDocumentId}
      inReview={renewal.status === 'IN_REVIEW'}
      kinds={kinds}
      district={district}
      appeal={evidenceAppeal}
      onSubmitted={() => {
        void refresh();
      }}
    />
  );
}

function RenewalEvidence(props: {
  readonly title: string;
  readonly applicationId: string | null;
  readonly renewalDocumentId: string;
  readonly inReview: boolean;
  readonly kinds: readonly EvidenceKind[];
  readonly district: string | null;
  readonly appeal: RenewalAppealView;
  readonly onSubmitted: () => void;
}) {
  const dt = useDriverText();
  const api = useDriverApi();
  const queue = useUploadQueue();
  const evidence = useEvidence(props.applicationId);
  useQueueRefresh(props.applicationId ?? 'none', queue.items);
  const submit = useMutation({ mutationFn: () => api.submitRenewal(props.renewalDocumentId), onSuccess: props.onSubmitted });
  const missing = submit.error === null ? [] : missingItems(refusalReasonCodes(submit.error));

  if (props.applicationId === null) {
    return (
      <Screen>
        <Stack.Screen options={{ title: props.title }} />
        <Title>{props.title}</Title>
        <Banner tone="info" text={dt('renewal.noApplication')} />
      </Screen>
    );
  }
  if (props.inReview || submit.isSuccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: props.title }} />
        <Title>{props.title}</Title>
        {props.district === null ? null : <Body muted>{props.district}</Body>}
        <Banner tone="info" text={dt(submit.isSuccess ? 'renewal.submitted' : 'renewal.inReview')} />
        <RenewalAppealNotice appeal={props.appeal} />
      </Screen>
    );
  }
  const view = viewStateFromQuery(combineQueries(evidence, { status: 'success', data: queue.items, error: null }), ([ev, items]) =>
    props.kinds.map((kind) => ({ kind, display: evidenceDisplay(props.renewalDocumentId, kind, ev.items, items) })),
  );
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: props.title }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void evidence.refetch();
          }}
        />
      </Screen>
    );
  }
  const uploading = view.data.some((s) => s.display.state === 'queued' || s.display.state === 'uploading' || s.display.state === 'processing');
  return (
    <Screen>
      <Stack.Screen options={{ title: props.title }} />
      <Title>{props.title}</Title>
      {props.district === null ? null : <Body muted>{props.district}</Body>}
      <Heading>{dt('claim.photosTitle')}</Heading>
      <EvidenceRows
        applicationId={props.applicationId}
        documentId={props.renewalDocumentId}
        slots={view.data}
        allowServerRemove
        onServerChange={() => {
          void evidence.refetch();
        }}
      />
      {missing.length > 0 ? (
        <View style={styles.group} accessibilityRole="alert">
          <Heading>{dt('docs.missingTitle')}</Heading>
          {missing.map((m, index) => (
            <Body key={String(index)}>
              {m.kind === 'evidence'
                ? dt('docs.missing.evidence', { evidence: dt(`evidence.${m.evidenceKind}`) })
                : m.kind === 'processing'
                  ? dt('docs.missing.processing')
                  : dt('docs.missing.unknown', { code: m.kind === 'unknown' ? m.code : m.kind })}
            </Body>
          ))}
        </View>
      ) : (
        <DriverErrorBanner error={submit.error === null ? null : driverErrorView(submit.error)} />
      )}
      {uploading ? <Banner tone="info" text={dt('docs.waitUploads')} /> : null}
      <Button
        label={dt('renewal.submit')}
        busyLabel={dt('renewal.submitting')}
        busy={submit.isPending}
        disabled={uploading}
        onPress={() => {
          submit.mutate();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
