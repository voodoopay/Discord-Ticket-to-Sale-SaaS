import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(configDir, '../..'),
  transpilePackages: ['three'],
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias['@voodoo/core'] = path.resolve(configDir, '../../packages/core/dist/index.js');
    return config;
  },
};

export default nextConfig;
