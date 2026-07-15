#!/usr/bin/env node
// Wired as the "build" npm script (this project has no compile step, so
// this repackaging step IS the build). Assembles the directory layout AWS
// Amplify Hosting's deployment specification expects:
// https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, '.amplify-hosting');
const COMPUTE_DIR = join(OUT, 'compute', 'default');
const STATIC_DIR = join(OUT, 'static');

console.log('[prepare-amplify] Cleaning previous output...');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(COMPUTE_DIR, { recursive: true });
mkdirSync(STATIC_DIR, { recursive: true });

console.log('[prepare-amplify] Copying static assets -> static/');
for (const f of ['index.html', 'widget.js', 'loader.js', 'Logo3.png', 'Logo3-768x137.webp', 'avatar-alex.png']) {
  cpSync(join(root, f), join(STATIC_DIR, f));
}
cpSync(join(root, 'test-pages'), join(STATIC_DIR, 'test-pages'), { recursive: true });

console.log('[prepare-amplify] Copying compute bundle -> compute/default/');
cpSync(join(root, 'server.mjs'), join(COMPUTE_DIR, 'server.mjs'));
cpSync(join(root, 'api'), join(COMPUTE_DIR, 'api'), { recursive: true });
cpSync(join(root, 'email-templates'), join(COMPUTE_DIR, 'email-templates'), { recursive: true });
cpSync(join(root, 'knowledge'), join(COMPUTE_DIR, 'knowledge'), { recursive: true });

console.log('[prepare-amplify] Copying node_modules -> compute/default/node_modules');
cpSync(join(root, 'node_modules'), join(COMPUTE_DIR, 'node_modules'), { recursive: true });

// Amplify Hosting's app-level "Environment variables" reach this build
// step's process.env but were confirmed NOT to reach the compute
// resource's process.env at request time (production returned
// {"error":"API key not configured"} despite the console value being set).
// Snapshot them here, at build time, into the compute bundle so server.mjs
// can load them into its own process.env before serving requests — see
// server.mjs's loadBuildTimeSecrets(). Lives only inside compute/default/,
// which is never served by the Static primitive, and is never committed
// (this whole directory is gitignored, regenerated fresh on every build).
console.log('[prepare-amplify] Writing build-time secrets snapshot -> compute/default/.runtime-secrets.json');
writeFileSync(
  join(COMPUTE_DIR, '.runtime-secrets.json'),
  JSON.stringify({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  })
);

const manifest = {
  version: 1,
  framework: { name: 'demski-chatbot-server', version: '1.0.0' },
  routes: [
    // /api/* must come first — routes match in array order, first wins.
    { path: '/api/*', target: { kind: 'Compute', src: 'default' } },
    { path: '/*.js', target: { kind: 'Static', cacheControl: 'public, max-age=300, must-revalidate' } },
    { path: '/*.webp', target: { kind: 'Static', cacheControl: 'public, max-age=86400, immutable' } },
    { path: '/*.png', target: { kind: 'Static', cacheControl: 'public, max-age=86400, immutable' } },
    { path: '/*', target: { kind: 'Static' } },
  ],
  computeResources: [
    { name: 'default', runtime: 'nodejs22.x', entrypoint: 'server.mjs' },
  ],
};

writeFileSync(join(OUT, 'deploy-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('[prepare-amplify] Done. Output at .amplify-hosting/');
