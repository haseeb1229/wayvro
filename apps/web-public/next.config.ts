import { STATIC_SECURITY_HEADERS } from '@wayvro/web-security';
import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@wayvro/contracts', '@wayvro/legal-content', '@wayvro/web-security'],
  headers: () => Promise.resolve([{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }]),
};

export default config;
