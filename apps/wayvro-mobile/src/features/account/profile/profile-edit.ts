import { ProfileUpdateRequestSchema, type Locale, type ProfileUpdateRequest } from '@wayvro/contracts';

/**
 * Profile edit (A05 UI): only the allowlisted fields (display name, preferred locale). Validation reuses the contract
 * schema so the client never accepts what the server would refuse; an empty name removes it (null).
 */
export interface ProfileValues {
  readonly displayName: string | null;
  readonly preferredLocale: Locale;
}

export interface ProfileDraft {
  readonly displayName: string;
  readonly preferredLocale: Locale;
}

export function draftFrom(values: ProfileValues): ProfileDraft {
  return { displayName: values.displayName ?? '', preferredLocale: values.preferredLocale };
}

export type ProfileUpdateCheck =
  { readonly ok: true; readonly update: ProfileUpdateRequest } | { readonly ok: false; readonly reason: 'no-changes' | 'invalid-name' };

export function buildProfileUpdate(original: ProfileValues, draft: ProfileDraft): ProfileUpdateCheck {
  const trimmed = draft.displayName.trim();
  const nextName = trimmed === '' ? null : trimmed;
  const nameChanged = nextName !== (original.displayName?.trim() || null);
  const localeChanged = draft.preferredLocale !== original.preferredLocale;
  if (!nameChanged && !localeChanged) return { ok: false, reason: 'no-changes' };
  const candidate: ProfileUpdateRequest = {
    ...(nameChanged ? { displayName: nextName } : {}),
    ...(localeChanged ? { preferredLocale: draft.preferredLocale } : {}),
  };
  const parsed = ProfileUpdateRequestSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: 'invalid-name' };
  return { ok: true, update: parsed.data };
}
