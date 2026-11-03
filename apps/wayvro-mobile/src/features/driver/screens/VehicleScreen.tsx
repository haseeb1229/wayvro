import { OWNERSHIP_TYPES, type DriverApplication } from '@wayvro/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { toApiError } from '../../../core/api/errors';
import { deviceTodayIso } from '../../../core/input/digits';
import { Section } from '../../../core/ui/components';
import { Banner, Body, Button, RadioGroup, Screen, TextField, Title } from '../../../core/ui/primitives';
import { DRIVER_KEYS } from '../api/driver-queries';
import {
  CAR_BODY_TYPES,
  buildVehicleCreate,
  buildVehicleUpdate,
  emptyVehicleForm,
  hasVehicleClaims,
  vehicleFormFrom,
  type AirConditioningChoice,
  type CarBodyType,
  type FieldErrors,
  type OwnershipType,
  type VehicleField,
  type VehicleForm,
} from '../onboarding/forms';
import { useDriverApi } from '../upload/upload-service';
import { ApplicationGate } from '../ui/ApplicationGate';
import { driverErrorView } from '../ui/driver-errors';
import { DriverErrorBanner, useDriverText } from '../ui/DriverUi';

/** "Your vehicle" (D02): one car for Lahore; a plate already on file becomes a reviewed affiliation, never a refusal. */
export default function VehicleScreen() {
  const dt = useDriverText();
  return <ApplicationGate title={dt('vehicle.title')}>{(application) => <VehicleFormView application={application} />}</ApplicationGate>;
}

function VehicleFormView({ application }: { readonly application: DriverApplication }) {
  const dt = useDriverText();
  const api = useDriverApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const existing = application.vehicles[0] ?? null;
  const [form, setForm] = useState<VehicleForm>(existing === null ? emptyVehicleForm : vehicleFormFrom(existing));
  const [errors, setErrors] = useState<FieldErrors<VehicleField>>({});
  const [noChanges, setNoChanges] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.application });
  const onError = (error: unknown) => {
    if (toApiError(error).kind === 'conflict') void refresh();
  };
  const add = useMutation({
    mutationFn: (request: Parameters<typeof api.addVehicle>[1]) => api.addVehicle(application.id, request),
    onSuccess: async () => {
      await refresh();
      router.back();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: (args: { vehicleId: string; request: Parameters<typeof api.updateVehicle>[2] }) =>
      api.updateVehicle(application.id, args.vehicleId, args.request),
    onSuccess: (app) => {
      queryClient.setQueryData(DRIVER_KEYS.application, app);
      router.back();
    },
    onError,
  });

  const submit = () => {
    const today = deviceTodayIso();
    if (existing === null) {
      const built = buildVehicleCreate(form, today);
      setNoChanges(false);
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      setErrors({});
      add.mutate(built.request);
      return;
    }
    const built = buildVehicleUpdate(existing, form, today);
    setNoChanges(!built.ok && built.nothingToSave === true);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    update.mutate({ vehicleId: existing.id, request: built.request });
  };

  const field = (name: VehicleField) => {
    const key = errors[name];
    return key === undefined ? null : dt(key);
  };
  const set = (patch: Partial<VehicleForm>) => {
    setForm({ ...form, ...patch });
  };
  const error = add.error ?? update.error;
  return (
    <Screen>
      <Stack.Screen options={{ title: dt('vehicle.title') }} />
      <Title>{dt('vehicle.title')}</Title>
      <Body>{dt('vehicle.body')}</Body>
      {existing?.relation === 'AUTHORISED_USER' ? <Banner tone="info" text={dt('vehicle.affiliated')} /> : null}
      <TextField
        label={dt('vehicle.plate')}
        value={form.plate}
        onChangeText={(plate) => {
          set({ plate });
        }}
        editable={existing === null}
        {...(existing === null ? {} : { hint: dt('vehicle.plateFixed') })}
        maxLength={16}
        error={field('plate')}
      />
      <TextField
        label={dt('vehicle.make')}
        value={form.make}
        onChangeText={(make) => {
          set({ make });
        }}
        maxLength={40}
        error={field('make')}
      />
      <TextField
        label={dt('vehicle.model')}
        value={form.model}
        onChangeText={(model) => {
          set({ model });
        }}
        maxLength={40}
        error={field('model')}
      />
      <TextField
        label={dt('vehicle.year')}
        value={form.year}
        onChangeText={(year) => {
          set({ year });
        }}
        keyboardType="number-pad"
        maxLength={4}
        error={field('year')}
      />
      <TextField
        label={dt('vehicle.colour')}
        value={form.colour}
        onChangeText={(colour) => {
          set({ colour });
        }}
        maxLength={30}
        error={field('colour')}
      />
      {existing === null ? (
        <TextField
          label={dt('vehicle.registration')}
          value={form.registrationNumber}
          onChangeText={(registrationNumber) => {
            set({ registrationNumber });
          }}
          maxLength={40}
          error={field('registrationNumber')}
        />
      ) : null}
      <RadioGroup<OwnershipType>
        label={dt('vehicle.ownership')}
        value={form.ownershipType}
        options={OWNERSHIP_TYPES.map((value) => ({ value, label: dt(`vehicle.ownership.${value}`) }))}
        onChange={(ownershipType) => {
          set({ ownershipType });
        }}
      />
      <Section title={dt('vehicle.claimsTitle')}>
        <Body muted>{dt('vehicle.claimsBody')}</Body>
        {existing !== null && hasVehicleClaims(existing) ? <Body muted>{dt('vehicle.claimsKept')}</Body> : null}
        <TextField
          label={dt('vehicle.seats')}
          hint={dt('vehicle.seatsHint')}
          value={form.seats}
          onChangeText={(seats) => {
            set({ seats });
          }}
          keyboardType="number-pad"
          maxLength={2}
          error={field('seats')}
        />
        <RadioGroup<CarBodyType | 'none'>
          label={dt('vehicle.bodyType')}
          value={form.bodyType}
          options={[
            ...CAR_BODY_TYPES.map((value) => ({ value, label: dt(`vehicle.bodyType.${value}`) })),
            { value: 'none' as const, label: dt('vehicle.notSaid') },
          ]}
          onChange={(bodyType) => {
            set({ bodyType });
          }}
        />
        <RadioGroup<AirConditioningChoice>
          label={dt('vehicle.ac')}
          value={form.airConditioned}
          options={[
            { value: 'yes', label: dt('vehicle.ac.yes') },
            { value: 'no', label: dt('vehicle.ac.no') },
            { value: 'none', label: dt('vehicle.notSaid') },
          ]}
          onChange={(airConditioned) => {
            set({ airConditioned });
          }}
        />
      </Section>
      {noChanges ? <Banner tone="info" text={dt('vehicle.noChanges')} /> : null}
      <DriverErrorBanner error={error === null ? null : driverErrorView(error)} />
      <Button
        label={dt(existing === null ? 'vehicle.add' : 'vehicle.update')}
        busyLabel={dt('driver.saving')}
        busy={add.isPending || update.isPending}
        onPress={submit}
      />
    </Screen>
  );
}
