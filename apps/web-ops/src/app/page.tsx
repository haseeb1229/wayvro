import { connection } from 'next/server';
import { STRINGS } from '../content/strings';

/** Shell only: no admin features and no fake authentication (CLAUDE.md §7/§11; docs/28 §11). */
export default async function OpsHomePage() {
  // Rendered per request so the proxy's CSP nonce is applied to framework scripts.
  await connection();
  return (
    <main>
      <h1>{STRINGS.title}</h1>
      <p>{STRINGS.notice}</p>
      <p role="alert">{STRINGS.warning}</p>
    </main>
  );
}
