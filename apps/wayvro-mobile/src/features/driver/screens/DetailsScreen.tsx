import type { DriverApplication } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { toApiError } from '../../../core/api/errors';
import { deviceTodayIso } from '../../../core/input/digits';
import { Banner, Body, Button, Screen, TextField, Title } from '../../../core/ui/primitives';
import { DRIVER_KEYS } from '../api/driver-queries';
import { buildClaimsUpdate, emptyDate, formatCnicInput, type ClaimsForm, type FieldErrors } from '../onboarding/forms';
import { useDriverApi } from '../upload/upload-service';
import { ApplicationGate } from '../ui/ApplicationGate';
import { driverErrorView } from '../ui/driver-errors';
import { DateFields, DriverErrorBanner, useDriverText } from '../ui/DriverUi';

/** "Your details" (D01 claims): legal name, CNIC (on-device format check only) and date of birth. */
export default function DetailsScreen() {
  const dt = useDriverText();
  return <ApplicationGate title={dt('details.title')}>{(application) => <DetailsForm application={application} />}</ApplicationGate>;
}

function DetailsForm({ application }: { readonly application: DriverApplication }) {
  const dt = useDriverText();
  const api = useDriverApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClaimsForm>({ legalName: '', cnic: '', dateOfBirth: emptyDate });
  const [errors, setErrors] = useState<FieldErrors<'legalName' | 'cnic' | 'dateOfBirth'>>({});
  const [nothing, setNothing] = useState(false);

  const save = useMutation({
    mutationFn: (request: Parameters<typeof api.updateClaims>[1]) => api.updateClaims(application.id, request),
    onSuccess: (app) => {
      queryClient.setQueryData(DRIVER_KEYS.application, app);
      router.back();
    },
    onError: (error) => {
      // A stale version (another device or step changed the application): reload server truth before the retry.
      if (toApiError(error).kind === 'conflict') void queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application });
    },
  });

  const submit = () => {
    const built = buildClaimsUpdate(application, form, deviceTodayIso());
    setNothing(!built.ok && built.nothingToSave === true);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    save.mutate(built.request);
  };

  const { claims } = application;
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('details.title') }} />
      <Title>{dt('details.title')}</Title>
      <Body>{dt('details.body')}</Body>
      <Body muted>{dt('details.privacy')}</Body>
      {claims.legalNameProvided ? <Body muted>{dt('details.nameOnFile')}</Body> : null}
      <TextField
        label={dt('details.legalName')}
        value={form.legalName}
        onChangeText={(legalName) => {
          setForm({ ...form, legalName });
        }}
        autoComplete="name"
        textContentType="name"
        maxLength={120}
        error={errors.legalName === undefined ? null : dt(errors.legalName)}
      />
      {claims.cnicLast4 === null ? null : <Body muted>{dt('details.cnicOnFile', { last4: claims.cnicLast4 })}</Body>}
      <TextField
        label={dt('details.cnic')}
        hint={dt('details.cnicHint')}
        value={form.cnic}
        onChangeText={(cnic) => {
          setForm({ ...form, cnic: formatCnicInput(cnic) });
        }}
        keyboardType="number-pad"
        autoComplete="off"
        maxLength={15}
        error={errors.cnic === undefined ? null : dt(errors.cnic)}
      />
      {claims.dateOfBirthProvided ? <Body muted>{dt('details.dobOnFile')}</Body> : null}
      <DateFields
        label={dt('details.dob')}
        value={form.dateOfBirth}
        onChange={(dateOfBirth) => {
          setForm({ ...form, dateOfBirth });
        }}
        error={errors.dateOfBirth === undefined ? null : dt(errors.dateOfBirth)}
      />
      <Body muted>{dt('details.service')}</Body>
      {nothing ? <Banner tone="info" text={dt('details.nothingToSave')} /> : null}
      <DriverErrorBanner error={save.error === null ? null : driverErrorView(save.error)} />
      <Button label={dt('driver.save')} busyLabel={dt('driver.saving')} busy={save.isPending} onPress={submit} />
    </Screen>
  );
}
