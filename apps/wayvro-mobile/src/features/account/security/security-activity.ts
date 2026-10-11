import type { SecurityEventList } from '@wayvro/contracts';
import type { StringKey } from '../../../core/i18n/strings';

/** Security activity (A11 UI). Every server event type has a catalogue label; a new contract type fails to compile here. */
type EventType = SecurityEventList['events'][number]['type'];

export interface SecurityEventRow {
  readonly id: string;
  readonly labelKey: StringKey;
  readonly occurredAt: string;
}

const labelKey = (type: EventType): `security.event.${EventType}` & StringKey => `security.event.${type}`;

export function securityEventsModel(list: SecurityEventList): readonly SecurityEventRow[] {
  return [...list.events]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .map((e) => ({ id: e.id, labelKey: labelKey(e.type), occurredAt: e.occurredAt }));
}
