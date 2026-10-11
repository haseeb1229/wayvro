import type { Metadata } from 'next';
import { connection } from 'next/server';
import { LoginForm } from '../../ui/AuthForms';

export const metadata: Metadata = { title: 'Wayvro Operations — Sign in' };

export default async function LoginPage() {
  await connection();
  return (
    <main>
      <LoginForm />
    </main>
  );
}
