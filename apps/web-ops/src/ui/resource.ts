/**
 * Shared client plumbing for the Phase-3 configuration screens (pricing, geo): contract-validated loads through the
 * BFF, act-then-reload mutations and user-safe failure text. A refusal is shown as a stable status class plus the
 * server's closed-catalogue reason codes, as text — never the server's message or any markup.
 */
import { useEffect, useState } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

export function refusalText(e: unknown): string {
  if (!(e instanceof BffError)) return STRINGS.errors.generic;
  const base =
    e.status === 400
      ? STRINGS.errors.validation
      : e.status === 403
        ? STRINGS.errors.forbidden
        : e.status === 404
          ? STRINGS.errors.notFound
          : e.status === 409
            ? STRINGS.errors.conflict
            : e.status === 429
              ? STRINGS.errors.rateLimited
              : e.status === 503
                ? STRINGS.errors.unavailable
                : STRINGS.errors.generic;
  return e.reasonCodes.length > 0 ? `${base} ${STRINGS.errors.refused} ${e.reasonCodes.join(', ')}` : base;
}

export interface Loaded<T> {
  readonly data: T | null;
  readonly error: string | null;
}

/**
 * GETs `path` whenever it or `version` changes and validates the body with `parse` (a module-level function, so the
 * effect does not re-run every render). A contract mismatch is a failure like any other: the last good data stays and
 * the error is shown.
 */
export function useLoad<T>(path: string | null, version: number, parse: (raw: unknown) => T): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null });
  useEffect(() => {
    if (path === null) return undefined;
    let live = true;
    bff<unknown>('GET', path)
      .then((raw) => {
        if (live) setState({ data: parse(raw), error: null });
      })
      .catch((e: unknown) => {
        if (live) setState((s) => ({ data: s.data, error: refusalText(e) }));
      });
    return () => {
      live = false;
    };
  }, [path, version, parse]);
  return state;
}

/** Runs a mutation; success or failure, `onSettled` reloads the authoritative server state. `fail` shows a local message. */
export function useAction(onSettled: () => void): {
  readonly status: string | null;
  readonly act: (fn: () => Promise<unknown>) => void;
  readonly fail: (message: string) => void;
} {
  const [status, setStatus] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setStatus(null);
    void fn().then(
      () => {
        onSettled();
      },
      (e: unknown) => {
        setStatus(refusalText(e));
        onSettled();
      },
    );
  };
  return { status, act, fail: setStatus };
}

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
export type CodeAnswer = { readonly ok: true; readonly code: string | undefined } | { readonly ok: false; readonly cancelled: boolean };

/** Asks for a reason code (browser dialog). An empty answer is allowed only when not `required`. */
export function askCode(question: string, required: boolean): CodeAnswer {
  const raw = window.prompt(question);
  if (raw === null) return { ok: false, cancelled: true };
  const v = raw.trim().toUpperCase();
  if (v === '' && !required) return { ok: true, code: undefined };
  return CODE.test(v) ? { ok: true, code: v } : { ok: false, cancelled: false };
}

/** A form value as trimmed text (a file input never feeds these forms). */
export const text = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '');

/** Who did something, without exposing staff ids on screen. */
export const actor = (staffId: string | null, selfId: string, labels: { readonly you: string; readonly other: string; readonly none: string }): string =>
  staffId === null ? labels.none : staffId === selfId ? labels.you : labels.other;

export const when = (iso: string | null): string => (iso === null ? '—' : new Date(iso).toLocaleString());
