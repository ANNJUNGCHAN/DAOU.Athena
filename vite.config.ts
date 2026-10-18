import { rmSync } from 'node:fs';
import path from 'node:path';
import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';

// Production masters and review clips are not site assets. Wrangler rejects
// any file over 25 MiB, so keep them out of dist/client even if they reappear
// under public/.
const EXCLUDED_CLIENT_ASSETS = [
  'feature-motion-review.html',
  'brand/kiwoom.svg',
  'media/case-films',
  'media/feature-motion-evidence',
  'media/feature-motion-review',
  'media/glaux-film.mp4',
  'media/glaux.vtt',
  'media/research.webm',
  'media/research.vtt',
  'media/strategy.webm',
  'media/strategy.vtt',
];

function stripExcludedClientAssets(): Plugin {
  const strip = () => {
    const root = path.resolve('dist/client');
    for (const relative of EXCLUDED_CLIENT_ASSETS) {
      rmSync(path.join(root, relative), { recursive: true, force: true });
    }
  };

  return {
    name: 'strip-excluded-client-assets',
    apply: 'build',
    writeBundle: strip,
    closeBundle: strip,
  };
}

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    // Build analysis must not invalidate dependencies served by the live preview.
    cacheDir:
      command === 'build' ? 'node_modules/.vite-build' : 'node_modules/.vite',
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
      stripExcludedClientAssets(),
    ],
  };
});
