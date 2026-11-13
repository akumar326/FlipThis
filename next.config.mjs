import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    // Loops never change between deploys of the same file name; let browsers cache them.
    return [{ source: '/audio/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] }];
  },
};
// Keep dev's cache separate from production builds and npm start.
export default (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
