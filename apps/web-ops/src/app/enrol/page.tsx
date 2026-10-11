import type { Metadata } from 'next';
import { connection } from 'next/server';
import { EnrolForm } from '../../ui/AuthForms';

export const metadata: Metadata = { title: 'Wayvro Operations — Register security key' };

export default async function EnrolPage() {
  await connection();
  return (
    <main>
      <EnrolForm />
    </main>
  );
}
