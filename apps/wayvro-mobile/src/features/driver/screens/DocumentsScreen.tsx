import type { DriverApplication } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '../../../core/api/errors';
import { useI18n } from '../../../core/i18n/I18nProvider';
import { Banner, Body, Button, Heading, LinkRow, Screen, StateView, Title } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { combineQueries, viewStateFromQuery } from '../../../core/ui/view-state';
import { DRIVER_KEYS, useEvidence, useRequirements } from '../api/driver-queries';
import { checklistModel, missingItems, type ChecklistItem, type MissingItem } from '../onboarding/checklist';
import { districtName } from '../onboarding/districts';
import { useDriverApi, useUploadQueue } from '../upload/upload-service';
import { ApplicationGate } from '../ui/ApplicationGate';
import { driverErrorView, refusalReasonCodes } from '../ui/driver-errors';
import { DriverErrorBanner, useDriverText } from '../ui/DriverUi';
import { documentLabel } from '../ui/labels';
import { useQueueRefresh } from '../ui/use-queue-refresh';

/** Requirement checklist (D01–D03) with the submission step; the server decides whether the application is complete. */
export default function DocumentsScreen() {
  const dt = useDriverText();
  return <ApplicationGate title={dt('docs.title')}>{(application) => <Checklist application={application} />}</ApplicationGate>;
}

function Checklist({ application }: { readonly application: DriverApplication }) {
  const dt = useDriverText();
  const api = useDriverApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const queue = useUploadQueue();
  const requirements = useRequirements(application.id);
  const evidence = useEvidence(application.id);
  useQueueRefresh(application.id, queue.items);
  const view = viewStateFromQuery(combineQueries(requirements, evidence), ([req, ev]) => checklistModel(req, application, ev.items, queue.items));

  const submit = useMutation({
    mutationFn: async () => {
      // The latest server version (an upload slot or another step may have advanced it) guards the submission.
      const fresh = await api.currentApplication();
      return api.submit(fresh.id, fresh.version);
    },
    onSuccess: (app) => {
      queryClient.setQueryData(DRIVER_KEYS.application, app);
      router.replace('/earn');
    },
    onError: (error) => {
      if (toApiError(error).kind === 'conflict') {
        void queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application });
        void queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.evidence(application.id) });
      }
    },
  });
  const missing = submit.error === null ? [] : missingItems(refusalReasonCodes(submit.error));

  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: dt('docs.title') }} />
        <StateView
          state={view}
          emptyKey="common.loading"
          onRetry={() => {
            void requirements.refetch();
            void evidence.refetch();
          }}
        />
      </Screen>
    );
  }
  const model = view.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('docs.title') }} />
      <Title>{dt('docs.title')}</Title>
      <Body>{dt('docs.body')}</Body>
      {model.placeholder ? <Banner tone="warning" text={dt('driver.placeholderSet')} /> : null}
      {queue.restoreFailed ? <Banner tone="warning" text={dt('driver.restoreFailed')} /> : null}
      <Body muted>{dt('overview.progress', { done: model.readyMandatory, total: model.totalMandatory })}</Body>
      {model.items.map((item) => (
        <ItemRow
          key={item.documentType}
          item={item}
          onPress={() => {
            router.push({ pathname: '/earn/document', params: { type: item.documentType } });
          }}
        />
      ))}
      {model.notApplicable.length > 0 ? (
        <View style={styles.group}>
          <Heading>{dt('docs.notApplicableTitle')}</Heading>
          {model.notApplicable.map((type) => (
            <Body key={type} muted>
              {documentLabel(dt, type)}
            </Body>
          ))}
        </View>
      ) : null}
      {missing.length > 0 ? <MissingList items={missing} /> : <DriverErrorBanner error={submit.error === null ? null : driverErrorView(submit.error)} />}
      {model.uploadsInFlight ? <Banner tone="info" text={dt('docs.waitUploads')} /> : null}
      <Body muted>{dt('docs.submitHint')}</Body>
      <Button
        label={dt('docs.submit')}
        busyLabel={dt('docs.submitting')}
        busy={submit.isPending}
        disabled={model.uploadsInFlight}
        onPress={() => {
          submit.mutate();
        }}
      />
    </Screen>
  );
}

function ItemRow({ item, onPress }: { readonly item: ChecklistItem; readonly onPress: () => void }) {
  const dt = useDriverText();
  const { locale } = useI18n();
  const name = documentLabel(dt, item.documentType);
  const status = dt(`docs.status.${item.status}`);
  const districtCode = item.document?.districtCode ?? null;
  const detail = districtCode === null ? status : `${status} · ${dt('docs.district', { district: districtName(locale, districtCode, item.districts) })}`;
  return <LinkRow label={`${name} · ${dt(item.mandatory ? 'docs.required' : 'docs.optional')}`} detail={detail} onPress={onPress} />;
}

function MissingList({ items }: { readonly items: readonly MissingItem[] }) {
  const dt = useDriverText();
  return (
    <View style={styles.group} accessibilityRole="alert">
      <Heading>{dt('docs.missingTitle')}</Heading>
      {items.map((item, index) => {
        switch (item.kind) {
          case 'document':
            return <Body key={String(index)}>{dt('docs.missing.document', { document: documentLabel(dt, item.documentType) })}</Body>;
          case 'evidence':
            return <Body key={String(index)}>{dt('docs.missing.evidence', { evidence: dt(`evidence.${item.evidenceKind}`) })}</Body>;
          case 'processing':
            return <Body key={String(index)}>{dt('docs.missing.processing')}</Body>;
          case 'no-requirement-set':
            return <Body key={String(index)}>{dt('docs.missing.noSet')}</Body>;
          case 'unknown':
            return <Body key={String(index)}>{dt('docs.missing.unknown', { code: item.code })}</Body>;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
