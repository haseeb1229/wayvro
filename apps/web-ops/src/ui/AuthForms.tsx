'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STRINGS } from '../content/strings';
import { enrol, login } from './client';

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="login-heading">
      <h1 id="login-heading">{STRINGS.login.heading}</h1>
      <p>{STRINGS.login.body}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void login()
            .then(() => {
              router.push('/');
              router.refresh();
            })
            .catch(() => {
              setError(STRINGS.login.failed);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {STRINGS.login.button}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <a href="/enrol">{STRINGS.login.enrolLink}</a>
      </p>
    </section>
  );
}

export function EnrolForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-labelledby="enrol-heading"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void enrol(token.trim(), nickname.trim())
          .then(() => {
            router.push('/');
            router.refresh();
          })
          .catch(() => {
            setError(STRINGS.enrol.failed);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <h1 id="enrol-heading">{STRINGS.enrol.heading}</h1>
      <p>{STRINGS.enrol.body}</p>
      <label>
        {STRINGS.enrol.token}
        <input
          name="invitation"
          autoComplete="off"
          required
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
          }}
        />
      </label>
      <label>
        {STRINGS.enrol.nickname}
        <input
          name="nickname"
          required
          maxLength={60}
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={busy}>
        {STRINGS.enrol.button}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
