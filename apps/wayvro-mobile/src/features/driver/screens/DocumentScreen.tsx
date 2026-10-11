import type { DriverApplication } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { toApiError } from '../../../core/api/errors';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { formatDate } from '../../../core/i18n/strings';
import { deviceTodayIso } from '../../../core/input/digits';
import { Banner, Body, Button, Heading, RadioGroup, Screen, StateView, TextField, Title } from '../../../core/ui/primitives';
import { combineQueries, viewStateFromQuery } from '../../../core/ui/view-state';
import { DRIVER_KEYS, useEvidence, useRequirements } from '../api/driver-queries';
import { checklistModel, type ChecklistItem } from '../onboarding/checklist';
import { districtName, districtOptions } from '../onboarding/districts';
import { buildDocumentClaim, emptyClaimForm, type ClaimField, type ClaimForm, type FieldErrors } from '../onboarding/forms';
import { useDriverApi, useUploadQueue } from '../upload/upload-service';
import { ApplicationGate } from '../ui/ApplicationGate';
import { driverErrorView } from '../ui/driver-errors';
import { DateFields, DriverErrorBanner, useDriverText } from '../ui/DriverUi';
import { EvidenceRows } from '../ui/EvidenceRows';
import { documentLabel } from '../ui/labels';
import { useQueueRefresh } from '../ui/use-queue-refresh';

/** One requirement item: its claims (number/class/dates where the type has them) and its photos. */
export default function DocumentScreen() {
  const dt = useDriverText();
  const raw = useLocalSearchParams<{ type?: string }>();
  // Route params are untrusted input: only a document-type code shape is accepted.
  const type = typeof raw.type === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(raw.type) ? raw.type : null;
  if (type === null) {
    return (
      <Screen scroll={false}>
        <Banner tone="error" text={dt('capture.invalidLink')} />
      </Screen>
    );
  }
  return <ApplicationGate title={documentLabel(dt, type)}>{(application) => <DocumentItem application={application} documentType={type} />}</ApplicationGate>;
}

function DocumentItem({ application, documentType }: { readonly application: DriverApplication; readonly documentType: string }) {
  const dt = useDriverText();
  const queue = useUploadQueue();
  const requirements = useRequirements(application.id);
  const evidence = useEvidence(application.id);
  useQueueRefresh(application.id, queue.items);
  const view = viewStateFromQuery(
    combineQueries(requirements, evidence),
    ([req, ev]) => checklistModel(req, application, ev.items, queue.items).items.find((i) => i.documentType === documentType) ?? null,
  );
  const title = documentLabel(dt, documentType);
  if (view.kind !== 'ready' || view.data === null) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title }} />
        {view.kind === 'ready' ? (
          <Banner tone="info" text={dt('claim.notInList')} />
        ) : (
          <StateView
            state={view}
            emptyKey="common.loading"
            onRetry={() => {
              void requirements.refetch();
              void evidence.refetch();
            }}
          />
        )}
      </Screen>
    );
  }
  return (
    <ItemEditor
      application={application}
      item={view.data}
      title={title}
      onEvidenceChange={() => {
        void evidence.refetch();
      }}
    />
  );
}

function ItemEditor(props: {
  readonly application: DriverApplication;
  readonly item: ChecklistItem;
  readonly title: string;
  readonly onEvidenceChange: () => void;
}) {
  const dt = useDriverText();
  const { locale } = useI18n();
  const api = useDriverApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { application, item } = props;
  const { hints } = item;
  const hasFields = hints.number || hints.licenceClass || hints.issuedOn || hints.expiresOn;
  const vehicleId = application.vehicles[0]?.id ?? null;
  const needsVehicle = item.subject !== 'DRIVER' && vehicleId === null;
  const [form, setForm] = useState<ClaimForm>(emptyClaimForm);
  const [errors, setErrors] = useState<FieldErrors<ClaimField>>({});
  const [saved, setSaved] = useState(false);

  const claim = useMutation({
    mutationFn: (request: Parameters<typeof api.claimDocument>[1]) => api.claimDocument(application.id, request),
    onSuccess: async () => {
      setForm(emptyClaimForm);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application });
    },
    onError: (error) => {
      if (toApiError(error).kind === 'conflict') void queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application });
    },
  });

  const save = () => {
    const built = buildDocumentClaim(
      item.documentType,
      hints,
      form,
      item.subject === 'DRIVER' ? null : vehicleId,
      // Only a per-district item carries a district, chosen from the server's list.
      item.perDistrict ? item.districts.map((d) => d.code) : null,
      deviceTodayIso(),
    );
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setSaved(false);
    claim.mutate(built.request);
  };
  const fieldError = (name: ClaimField) => {
    const key = errors[name];
    return key === undefined ? null : dt(key);
  };

  if (needsVehicle) {
    return (
      <Screen>
        <Stack.Screen options={{ title: props.title }} />
        <Title>{props.title}</Title>
        <Banner tone="info" text={dt('claim.needsVehicle')} />
        <Button
          label={dt('overview.vehicle')}
          onPress={() => {
            router.push('/earn/vehicle');
          }}
        />
      </Screen>
    );
  }
  const document = item.document;
  const numberLast4 = document?.numberLast4 ?? null;
  const expiresOn = document?.claimedExpiresOn ?? null;
  const districtOnFile = document?.districtCode ?? null;
  const districtError = fieldError('district');
  return (
    <Screen>
      <Stack.Screen options={{ title: props.title }} />
      <Title>{props.title}</Title>
      <Body muted>{dt(item.mandatory ? 'docs.required' : 'docs.optional')}</Body>
      {hasFields ? <Body>{dt('claim.body')}</Body> : null}
      {numberLast4 === null ? null : <Body muted>{dt('claim.numberOnFile', { last4: numberLast4 })}</Body>}
      {expiresOn === null ? null : <Body muted>{dt('claim.expiresOnFile', { date: formatDate(expiresOn, locale) })}</Body>}
      {districtOnFile === null ? null : <Body muted>{dt('claim.districtOnFile', { district: districtName(locale, districtOnFile, item.districts) })}</Body>}
      {saved ? <Banner tone="info" text={dt('claim.saved')} /> : null}
      {item.perDistrict ? (
        item.claimable ? (
          <>
            <Body muted>{dt('claim.districtHint')}</Body>
            <RadioGroup
              label={dt('claim.district')}
              value={form.districtCode}
              options={districtOptions(locale, item.districts)}
              onChange={(districtCode) => {
                setForm({ ...form, districtCode });
              }}
            />
            {districtError === null ? null : <Banner tone="error" text={districtError} />}
          </>
        ) : (
          <Banner tone="info" text={dt('claim.noDistrict')} />
        )
      ) : null}
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
        item.licenceClassesAllowed.length > 0 ? (
          <RadioGroup
            label={dt('claim.licenceClass')}
            value={form.licenceClass}
            options={item.licenceClassesAllowed.map((value) => ({ value, label: value }))}
            onChange={(licenceClass) => {
              setForm({ ...form, licenceClass });
            }}
          />
        ) : (
          <TextField
            label={dt('claim.licenceClass')}
            value={form.licenceClass}
            onChangeText={(licenceClass) => {
              setForm({ ...form, licenceClass });
            }}
            maxLength={12}
            error={fieldError('licenceClass')}
          />
        )
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
      {hints.expiresOn ? (
        <DateFields
          label={dt('claim.expiresOn')}
          value={form.expiresOn}
          onChange={(expiresOn) => {
            setForm({ ...form, expiresOn });
          }}
          error={fieldError('expiresOn')}
        />
      ) : null}
      {document === null ? null : <Body muted>{dt('claim.reclaimNote')}</Body>}
      <DriverErrorBanner error={claim.error === null ? null : driverErrorView(claim.error)} />
      {item.claimable && (document === null || hasFields) ? (
        <Button label={dt('claim.save')} busyLabel={dt('driver.saving')} busy={claim.isPending} onPress={save} />
      ) : null}
      <Heading>{dt('claim.photosTitle')}</Heading>
      {document === null ? (
        <Body muted>{dt('claim.saveFirst')}</Body>
      ) : (
        <EvidenceRows applicationId={application.id} documentId={document.id} slots={item.evidence} allowServerRemove onServerChange={props.onEvidenceChange} />
      )}
    </Screen>
  );
}
