import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { STRINGS } from '../content/strings';

export const metadata: Metadata = {
  title: STRINGS.title,
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
