import type { AccountState, AgeDeclarationRequest } from '@wayvro/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../core/i18n/I18nProvider';
import type { StringKey } from '../../../core/i18n/strings';
import { QUERY_KEYS } from '../../../core/query/query-client';
import { useServices } from '../../../core/services/ServicesProvider';
import { Banner, Body, Button, Checkbox, ErrorBanner, PlaceholderBadge, Screen, StateView, TextField, Title } from '../../../core/ui/primitives';
import { spacing } from '../../../core/ui/tokens';
import { viewStateFromQuery } from '../../../core/ui/view-state';
import { SignOutButton } from '../home/SignOutButton';
import { ageDeclarationError, ageFormModel, buildAgeDeclaration, type AgeForm } from './age-declaration';

/** Device-local calendar date (UX validation only; the server re-validates on its own clock). */
function todayIso(): string {
  const d = new Date();
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AgeDeclarationScreen() {
  const { client } = useServices();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: QUERY_KEYS.agePolicy, queryFn: () => client.agePolicy() });
  const [affirmed, setAffirmed] = useState(false);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [formError, setFormError] = useState<StringKey | null>(null);

  const declare = useMutation({
    mutationFn: (request: AgeDeclarationRequest) => client.declareAge(request),
    // A date of birth is not kept in the mutation cache after the attempt.
    gcTime: 0,
    onSuccess: async (recorded) => {
      queryClient.setQueryData<AccountState>(QUERY_KEYS.accountState, (old) => (old ? { ...old, requiredActions: recorded.requiredActions } : old));
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
    },
  });

  const view = viewStateFromQuery(policy, ageFormModel);
  if (view.kind !== 'ready') {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('age.title') }} />
        <StateView
          state={view}
          emptyKey="age.notRequired"
          onRetry={() => {
            void policy.refetch();
          }}
        />
      </Screen>
    );
  }

  const form: AgeForm = view.data;
  const failure = declare.isError ? ageDeclarationError(declare.error, form.mode) : null;
  const submit = () => {
    const built = buildAgeDeclaration(form, { affirmed, dob: { day, month, year } }, todayIso());
    if (!built.ok) {
      setFormError(built.errorKey);
      return;
    }
    setFormError(null);
    declare.mutate(built.request, {
      onError: (error) => {
        if (ageDeclarationError(error, form.mode).refetch) {
          void policy.refetch();
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
        }
      },
    });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('age.title') }} />
      <Title>{t('age.title')}</Title>
      {view.stale ? <Banner tone="warning" text={t('common.staleData')} /> : null}
      {form.placeholder ? <PlaceholderBadge /> : null}
      {form.mode === 'NONE' ? (
        <>
          <Body>{t('age.notRequired')}</Body>
          <Button
            label={t('common.continue')}
            onPress={() => {
              void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountState });
            }}
          />
        </>
      ) : (
        <>
          {form.mode === 'AFFIRM_MINIMUM_AGE' ? (
            <>
              <Body>{t('age.affirmHelp')}</Body>
              <Checkbox
                label={t(form.statementKey, form.statementParams)}
                checked={affirmed}
                onChange={(next) => {
                  setAffirmed(next);
                  setFormError(null);
                }}
              />
            </>
          ) : (
            <>
              <Body>{t('age.dobHelp')}</Body>
              <Body>{t('age.dobLabel')}</Body>
              <View style={styles.dobRow}>
                <View style={styles.dobPart}>
                  <TextField label={t('age.day')} value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} autoComplete="birthdate-day" />
                </View>
                <View style={styles.dobPart}>
                  <TextField
                    label={t('age.month')}
                    value={month}
                    onChangeText={setMonth}
                    keyboardType="number-pad"
                    maxLength={2}
                    autoComplete="birthdate-month"
                  />
                </View>
                <View style={styles.dobYear}>
                  <TextField label={t('age.year')} value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} autoComplete="birthdate-year" />
                </View>
              </View>
            </>
          )}
          {formError === null ? null : <Banner tone="error" text={t(formError)} />}
          {failure === null ? null : <ErrorBanner error={failure.view} />}
          <Button label={t('age.submit')} busyLabel={t('common.saving')} busy={declare.isPending} onPress={submit} />
        </>
      )}
      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dobRow: { flexDirection: 'row', gap: spacing.sm },
  dobPart: { flex: 1 },
  dobYear: { flex: 2 },
});
