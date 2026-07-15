// Amplify Hosting compute entrypoint. Serves /api/chat and /api/send-lead by
// invoking the existing Vercel-style handlers unmodified, via a thin
// compatibility shim over Node's raw http module: req.body (manual JSON
// parsing) and res.status()/res.json() (Vercel Node runtime helpers that
// don't exist on raw http.ServerResponse). Static files (index.html,
// widget.js, etc.) are handled separately by Amplify's Static primitive —
// see deploy-manifest.json — this process only ever serves /api/*.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chatHandler from './api/chat.js';
import sendLeadHandler from './api/send-lead.js';

// Amplify Hosting's app-level "Environment variables" are confirmed to
// reach the BUILD phase (npm run build), but empirically do NOT show up in
// this compute resource's process.env at request time (production returned
// {"error":"API key not configured"} despite OPENAI_API_KEY being set in
// the console, and the deploy-manifest.json spec has no per-compute
// "environment" field to request it either). prepare-amplify.mjs snapshots
// the build-time values into .runtime-secrets.json next to this file; load
// them here, before the server starts accepting requests, as a fallback so
// api/chat.js and api/send-lead.js's own process.env.* reads (evaluated
// lazily per-request, not at import time) keep working unmodified.
function loadBuildTimeSecrets() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const secretsPath = join(__dirname, '.runtime-secrets.json');
  if (!existsSync(secretsPath)) return;
  try {
    const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
    for (const [key, value] of Object.entries(secrets)) {
      if (value && !process.env[key]) process.env[key] = value;
    }
  } catch (e) {
    console.error('[server] Failed to load .runtime-secrets.json:', e.message);
  }
}
loadBuildTimeSecrets();

const PORT = process.env.PORT || 3000;

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Adds Vercel's res.status()/res.json() convenience methods on top of the
// raw http.ServerResponse so chat.js/send-lead.js run completely unmodified.
function enhanceResponse(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (payload) {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

const routes = {
  '/api/chat': chatHandler,
  '/api/send-lead': sendLeadHandler,
};

const server = createServer(async (req, res) => {
  enhanceResponse(res);

  // vercel.json previously applied this globally to every /api/* response
  // (not just OPTIONS preflights). Set it as a default here so
  // chat.js/send-lead.js's own OPTIONS-only header calls stay authoritative
  // (they run after this and win), while every other response still gets it.
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { pathname } = new URL(req.url, 'http://localhost');
  const handler = routes[pathname];

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  req.body = req.method === 'POST' ? await readJsonBody(req) : {};

  try {
    await handler(req, res);
  } catch (e) {
    console.error('[server] Unhandled error:', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Chatbot compute server listening on port ${PORT}`);
});
