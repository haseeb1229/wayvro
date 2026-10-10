import { connection } from 'next/server';
import { STRINGS } from '../content/strings';

/** Shell page only: no booking, lead capture or tracking until their phases and legal pages exist (W01–W09). */
export default async function HomePage() {
  // Rendered per request so the proxy's CSP nonce is applied to framework scripts.
  await connection();
  return (
    <main>
      <h1>{STRINGS.en.title}</h1>
      <p>{STRINGS.en.tagline}</p>
      <p>{STRINGS.en.status}</p>
      <section lang="ur" dir="rtl">
        <h2>{STRINGS.ur.title}</h2>
        <p>{STRINGS.ur.tagline}</p>
        <p>{STRINGS.ur.status}</p>
      </section>
    </main>
  );
}
