// Regenerates the Lambda deployment package (lambda-api/) from the
// canonical source (../api, ../knowledge, ../email-templates) and zips it
// into an upload-ready .zip. Run this after any change to api/chat.js,
// api/send-lead.js, api/_lib/knowledge.js, knowledge/**, or
// email-templates/** — those are copied here, not symlinked, so the zip
// goes stale otherwise.
//
// Usage: node aws/build.mjs
import { cpSync, rmSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(__dirname, 'lambda-api');

function resetDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function buildSource() {
  resetDir(join(OUT, 'api', '_lib'));
  resetDir(join(OUT, 'knowledge'));
  resetDir(join(OUT, 'email-templates'));
  cpSync(join(ROOT, 'api', 'chat.js'), join(OUT, 'api', 'chat.js'));
  cpSync(join(ROOT, 'api', 'send-lead.js'), join(OUT, 'api', 'send-lead.js'));
  cpSync(join(ROOT, 'api', '_lib', 'knowledge.js'), join(OUT, 'api', '_lib', 'knowledge.js'));
  cpSync(join(ROOT, 'knowledge'), join(OUT, 'knowledge'), { recursive: true });
  cpSync(join(ROOT, 'email-templates', 'chatbot-lead-notification.html'), join(OUT, 'email-templates', 'chatbot-lead-notification.html'));
  cpSync(join(ROOT, 'email-templates', 'chatbot-lead-confirmation.html'), join(OUT, 'email-templates', 'chatbot-lead-confirmation.html'));
  console.log('[build] lambda-api source synced');
  execFileSync('npm', ['install', '--omit=dev'], { cwd: OUT, stdio: 'inherit', shell: true });
}

function zip() {
  const zipPath = join(__dirname, 'lambda-api.zip');
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Compress-Archive -Path "${OUT}\\*" -DestinationPath "${zipPath}"`],
    { stdio: 'inherit' }
  );
  console.log('[build] wrote', zipPath);
}

buildSource();
zip();
console.log('[build] done — upload aws/lambda-api.zip to your Lambda function');
