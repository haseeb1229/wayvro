'use client';

/**
 * Web account-deletion form (U06): phone → code → generic confirmation. It talks only to web-public's own
 * same-origin route handlers (server-side forwarding to the API). Every answer is generic: the page never says
 * whether a number belongs to an account. The browser id is random per page visit (never a fingerprint) and every
 * submission carries a fresh idempotency key.
 */
import { ErrorEnvelopeSchema, OtpChallengeSchema, WebDeletionReceiptSchema } from '@wayvro/contracts';
import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import type { LegalLocale } from '../legal/view';
import { DELETION_STRINGS } from './strings';

type Step = 'PHONE' | 'CODE' | 'DONE';
type Field = 'phone' | 'code' | 'form';
interface FormError {
  readonly field: Field;
  readonly message: string;
}
type Answer = { readonly status: number; readonly body: unknown } | { readonly status: 'NETWORK' };

/** Random token of `bytes` bytes as hex ([0-9a-f], so it matches InstallationIdSchema and the idempotency-key rule). */
function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Arabic-Indic and Urdu/Persian digits typed with an Urdu keyboard become ASCII (both blocks start at …0, so % 16). */
function asciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => String((d.codePointAt(0) ?? 0) % 16));
}

/** Display-level check only (empty / impossible characters); the server decides whether the number is valid. */
const PHONE_CHARACTERS = /^\+?[0-9\s\-.()]+$/;

async function post(path: string, body: unknown): Promise<Answer> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomToken(16) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text.length > 0 ? (JSON.parse(text) as unknown) : null };
  } catch (e) {
    if (e instanceof TypeError || e instanceof SyntaxError) return { status: 'NETWORK' };
    throw e;
  }
}

const subscribeNever = (): (() => void) => () => undefined;
/** False during server rendering and before hydration, so nothing can be submitted without the script. */
const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

export function DeletionForm({ locale }: { readonly locale: LegalLocale }) {
  const s = DELETION_STRINGS[locale];
  const hydrated = useHydrated();
  const [step, setStep] = useState<Step>('PHONE');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ readonly challengeId: string; readonly maskedDestination: string } | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);
  const browserId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

  // Focus follows the step (not on first render), so screen-reader and keyboard users land on the new content.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  const visitId = (): string => {
    browserId.current ??= randomToken(24);
    return browserId.current;
  };
  const goTo = (next: Step) => {
    moved.current = true;
    setError(null);
    setStep(next);
  };
  const fail = (field: Field, message: string) => {
    setError({ field, message });
    if (field === 'phone') phoneInput.current?.focus();
    if (field === 'code') codeInput.current?.focus();
  };
  /** Maps any answer that is not the expected success to generic copy; 400/401 belong to the field, the rest to the form. */
  const refused = (answer: Answer, field: 'phone' | 'code') => {
    if (answer.status === 400) {
      fail(field, field === 'phone' ? s.errors.phoneInvalid : s.errors.codeFormat);
    } else if (answer.status === 401 && field === 'code') {
      fail('code', s.errors.codeRejected);
    } else if (answer.status === 429) {
      const envelope = ErrorEnvelopeSchema.safeParse(answer.body);
      const seconds = envelope.success ? envelope.data.error.details?.retryAfterSeconds : undefined;
      fail('form', seconds === undefined ? s.errors.rateLimited : s.retryIn(Math.max(1, Math.ceil(seconds / 60))));
    } else {
      fail('form', s.errors.unavailable);
    }
  };

  const requestCode = async () => {
    const value = phone.trim();
    if (value.length === 0) {
      fail('phone', s.errors.phoneRequired);
      return;
    }
    if (value.length > 40 || !PHONE_CHARACTERS.test(asciiDigits(value))) {
      fail('phone', s.errors.phoneInvalid);
      return;
    }
    const answer = await post('/account-deletion/otp-challenges', { phone: value, browserId: visitId(), locale });
    const issued = answer.status === 202 ? OtpChallengeSchema.safeParse(answer.body) : null;
    if (issued?.success) {
      setChallenge({ challengeId: issued.data.challengeId, maskedDestination: issued.data.maskedDestination });
      setCode('');
      goTo('CODE');
    } else refused(answer, 'phone');
  };

  const confirm = async () => {
    if (!challenge) {
      goTo('PHONE');
      return;
    }
    const value = asciiDigits(code).replace(/\s/g, '');
    if (!/^\d{6}$/.test(value)) {
      fail('code', s.errors.codeFormat);
      return;
    }
    const answer = await post('/account-deletion/requests', { challengeId: challenge.challengeId, code: value, browserId: visitId() });
    if (answer.status === 202 && WebDeletionReceiptSchema.safeParse(answer.body).success) {
      setChallenge(null);
      setCode('');
      goTo('DONE');
    } else refused(answer, 'code');
  };

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const action = step === 'CODE' ? confirm : requestCode;
    setBusy(true);
    setError(null);
    action()
      .catch(() => {
        fail('form', s.errors.unavailable);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const fieldError = (field: Field) =>
    error?.field === field ? (
      <p id={`deletion-${field}-error`} role="alert" data-testid={`deletion-${field}-error`}>
        {error.message}
      </p>
    ) : null;
  const describedBy = (field: 'phone' | 'code', hint: string): string => (error?.field === field ? `${hint} deletion-${field}-error` : hint);
  const submitDisabled = !hydrated || busy;

  if (step === 'DONE') {
    return (
      <section aria-labelledby="deletion-step-heading">
        <h2 id="deletion-step-heading" ref={heading} tabIndex={-1}>
          {s.doneHeading}
        </h2>
        <p role="status" data-testid="deletion-done">
          {s.done}
        </p>
      </section>
    );
  }

  if (step === 'CODE') {
    return (
      <section aria-labelledby="deletion-step-heading">
        <h2 id="deletion-step-heading" ref={heading} tabIndex={-1}>
          {s.codeHeading}
        </h2>
        <p id="deletion-code-hint">
          {s.codeSentTo} <bdi dir="ltr">{challenge?.maskedDestination}</bdi> {s.codeExpiry}
        </p>
        <form method="post" noValidate onSubmit={submit}>
          <label htmlFor="deletion-code">{s.codeLabel}</label>{' '}
          <input
            ref={codeInput}
            id="deletion-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            dir="ltr"
            required
            value={code}
            aria-invalid={error?.field === 'code'}
            aria-describedby={describedBy('code', 'deletion-code-hint')}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
          {fieldError('code')}
          {fieldError('form')}
          <p>
            <button type="submit" disabled={submitDisabled} aria-busy={busy}>
              {busy ? s.busy : s.confirm}
            </button>{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setChallenge(null);
                goTo('PHONE');
              }}
            >
              {s.startOver}
            </button>
          </p>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="deletion-step-heading">
      <h2 id="deletion-step-heading" ref={heading} tabIndex={-1}>
        {s.requestHeading}
      </h2>
      <form method="post" noValidate onSubmit={submit}>
        <label htmlFor="deletion-phone">{s.phoneLabel}</label>
        <p id="deletion-phone-hint">{s.phoneHint}</p>
        <input
          ref={phoneInput}
          id="deletion-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          dir="ltr"
          required
          value={phone}
          aria-invalid={error?.field === 'phone'}
          aria-describedby={describedBy('phone', 'deletion-phone-hint')}
          onChange={(e) => {
            setPhone(e.target.value);
          }}
        />
        {fieldError('phone')}
        {fieldError('form')}
        <p>
          <button type="submit" disabled={submitDisabled} aria-busy={busy}>
            {busy ? s.busy : s.sendCode}
          </button>
        </p>
      </form>
    </section>
  );
}
