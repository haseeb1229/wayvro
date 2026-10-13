'use client';

import type { StaffMe } from '@wayvro/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { STRINGS } from '../content/strings';
import { LOCKED_EVENT, bff, logout, unlock } from './client';

const IDLE_MS = 15 * 60 * 1000;

/**
 * Authenticated shell: environment banner on every page (W07), navigation derived from server-provided permissions
 * (UX only — the API authorises every call), idle lock overlay (server-enforced; the client timer only re-checks).
 */
export function Shell({ me, initiallyLocked, children }: { readonly me: StaffMe; readonly initiallyLocked: boolean; readonly children: ReactNode }) {
  const router = useRouter();
  const [locked, setLocked] = useState(initiallyLocked);
  const [error, setError] = useState<string | null>(null);
  const can = (p: string) => me.permissions.includes(p);

  useEffect(() => {
    const onLocked = () => {
      setLocked(true);
    };
    window.addEventListener(LOCKED_EVENT, onLocked);
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    for (const e of ['keydown', 'pointerdown']) window.addEventListener(e, touch);
    const timer = window.setInterval(() => {
      if (Date.now() - last > IDLE_MS) {
        void bff('GET', 'me').catch(() => undefined);
      }
    }, 60_000);
    return () => {
      window.removeEventListener(LOCKED_EVENT, onLocked);
      for (const e of ['keydown', 'pointerdown']) window.removeEventListener(e, touch);
      window.clearInterval(timer);
    };
  }, []);

  const env = me.environment;
  return (
    <>
      <div role="status" data-testid="environment-banner" className={`env env-${env.toLowerCase()}`}>
        {STRINGS.environment[env]}
      </div>
      {me.breakGlass ? (
        <p role="alert" data-testid="break-glass-banner">
          {STRINGS.home.breakGlassActive} {me.breakGlass.expiresAt}
        </p>
      ) : null}
      {me.pendingBreakGlassReviews ? (
        <p role="alert">
          {me.pendingBreakGlassReviews} {STRINGS.home.breakGlassPending}
        </p>
      ) : null}
      <header>
        <nav aria-label="Main">
          <ul>
            <li>
              <Link href="/">{STRINGS.nav.home}</Link>
            </li>
            {can('staff.view_roster') ? (
              <li>
                <Link href="/staff">{STRINGS.nav.staff}</Link>
              </li>
            ) : null}
            {can('audit.events.view') ? (
              <li>
                <Link href="/audit">{STRINGS.nav.audit}</Link>
              </li>
            ) : null}
            {can('kyc.queue.view') ? (
              <li>
                <Link href="/review">{STRINGS.nav.review}</Link>
              </li>
            ) : null}
            {can('appeal.view') ? (
              <li>
                <Link href="/appeals">{STRINGS.nav.appeals}</Link>
              </li>
            ) : null}
            {can('compliance.expiry_roster.view') ? (
              <li>
                <Link href="/expiry">{STRINGS.nav.expiry}</Link>
              </li>
            ) : null}
            {can('compliance.requirement_set.view') ? (
              <li>
                <Link href="/compliance">{STRINGS.nav.compliance}</Link>
              </li>
            ) : null}
            {can('restriction.view') ? (
              <li>
                <Link href="/restrictions">{STRINGS.nav.restrictions}</Link>
              </li>
            ) : null}
            {can('account.summary.view_masked') ? (
              <li>
                <Link href="/support">{STRINGS.nav.support}</Link>
              </li>
            ) : null}
            {can('catalog.view') ? (
              <>
                <li>
                  <Link href="/catalog">{STRINGS.nav.catalog}</Link>
                </li>
                <li>
                  <Link href="/zones">{STRINGS.nav.zones}</Link>
                </li>
              </>
            ) : null}
            {can('release.view') ? (
              <li>
                <Link href="/release">{STRINGS.nav.release}</Link>
              </li>
            ) : null}
            {can('breakglass.activate') || can('breakglass.review') ? (
              <li>
                <Link href="/break-glass">{STRINGS.nav.breakGlass}</Link>
              </li>
            ) : null}
            <li>
              <Link href="/security">{STRINGS.nav.security}</Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  void logout().then(() => {
                    router.push('/login');
                  });
                }}
              >
                {STRINGS.nav.signOut}
              </button>
            </li>
          </ul>
        </nav>
        <p>{me.staff.displayName}</p>
      </header>
      {locked ? (
        <div role="dialog" aria-modal="true" aria-labelledby="lock-heading" data-testid="lock-overlay">
          <h2 id="lock-heading">{STRINGS.lock.heading}</h2>
          <p>{STRINGS.lock.body}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void unlock()
                .then(() => {
                  setLocked(false);
                  router.refresh();
                })
                .catch(() => {
                  setError(STRINGS.errors.generic);
                });
            }}
          >
            {STRINGS.lock.button}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : (
        <main>{children}</main>
      )}
    </>
  );
}
