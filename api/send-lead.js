import sgMail from '@sendgrid/mail';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOTIFY_TO = ['andrew.demski@demskigroupdev.com', 'aaron.demski@demskigroupdev.com'];
const FROM_EMAIL = 'aaron.demski@demskigroupdev.com';
const CONFIRMATION_FROM_EMAIL = 'contact@demskigroupdev.com';

const LEAD_FIELDS = [
  'intent', 'intent_detail', 'budget', 'project_notes',
  'name', 'phone', 'email', 'company', 'cta_choice',
  'page', 'page_name',
  'utm_source', 'utm_campaign', 'utm_medium', 'utm_term', 'utm_content', 'gclid',
  'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp', 'ga',
  'landing_page', 'referrer', 'page_url',
];

// Zapier Catch Hook (Cosmoforge). Fired server-side after a successful lead
// submission so ONE implementation covers every source (contact form, the
// shared ContactSection, the calculator, and the chatbot) and the hook URL
// never appears in the public repo or in browser code. The URL comes from the
// ZAPIER_WEBHOOK_URL env var (baked into the compute bundle at build time by
// scripts/prepare-amplify.mjs, same mechanism as the other keys).
// Fire-and-forget: any failure is logged and never affects the API response,
// the emails, or the visitor's experience.
function sendToZapier(lead) {
  const url = process.env.ZAPIER_WEBHOOK_URL;
  if (!url) {
    logError('ZAPIER_WEBHOOK_URL not set — skipping webhook');
    return;
  }
  const payload = { ...lead, submitted_at: new Date().toISOString() };
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  }).then((res) => {
    if (res.ok) {
      log('Zapier webhook: delivered (HTTP', res.status + ')');
    } else {
      logError('Zapier webhook: rejected with HTTP', res.status);
    }
  }).catch((e) => {
    logError('Zapier webhook: failed (non-blocking) —', e.message);
  });
}

// Lead field values come straight from an anonymous website visitor and are
// inserted into HTML emails opened in a real mail client — without escaping,
// a name/notes value like "<script>..." or "<img onerror=...>" is injected
// as live markup into both the internal notification email and (via
// user_name) the visitor's own confirmation email.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillTemplate(html, data) {
  return html.replace(/\{\{(\w+)\}\}/g, function (_match, key) {
    return data[key] !== undefined && data[key] !== null && data[key] !== '' ? escapeHtml(data[key]) : '';
  });
}

// Mask PII before it reaches the logs (CloudWatch). Enough remains to debug
// (domain, last 4 digits, first initial) without storing raw personal data
// in log retention. These are used only for logging — the real, unmasked
// values still flow to the email templates unchanged.
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '[redacted]';
  const [local, domain] = email.split('@');
  return (local.slice(0, 1) || '') + '***@' + domain;
}
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length < 4 ? '***' : '***' + digits.slice(-4);
}
function redactLead(lead) {
  return {
    intent: lead.intent,
    budget: lead.budget,
    name: lead.name ? lead.name.slice(0, 1) + '***' : '',
    email: maskEmail(lead.email),
    phone: maskPhone(lead.phone),
    cta_choice: lead.cta_choice,
    page: lead.page,
  };
}

function log(...args) {
  console.log('[send-lead]', ...args);
}

function logError(...args) {
  console.error('[send-lead]', ...args);
}

// Extracts the useful bits out of a SendGrid error so they show up in
// Vercel Function Logs instead of an opaque "ECONNRESET"-style message.
function describeSendGridError(e) {
  const status = e.code || e.response?.statusCode;
  const body = e.response?.body;
  return {
    status,
    message: e.message,
    errors: body?.errors || body,
  };
}

export default async function handler(req, res) {
  // CORS preflight: the widget may be served from a different origin than
  // this API (e.g. embedded via the standalone widget domain), which makes
  // the browser send an OPTIONS preflight before the real POST. Without
  // this, the preflight gets a 405 and the browser blocks the POST,
  // producing a silent failure with no email ever attempted.
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    logError('Rejected non-POST request:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logError('SENDGRID_API_KEY is not set in the environment');
    return res.status(500).json({ error: 'SendGrid API key not configured' });
  }
  sgMail.setApiKey(apiKey);

  const body = req.body || {};
  const lead = {};
  for (const field of LEAD_FIELDS) lead[field] = body[field] || '';

  log('Incoming lead (redacted):', redactLead(lead));

  if (!lead.email || !lead.name) {
    logError('Missing required fields. name=%s email=%s', lead.name ? 'set' : 'missing', lead.email ? 'set' : 'missing');
    return res.status(400).json({ error: 'Missing required lead fields (name, email)' });
  }

  function readTemplate(filename) {
    const candidates = [
      join(__dirname, '..', 'email-templates', filename),
      join(__dirname, 'email-templates', filename),
      join(process.cwd(), 'email-templates', filename),
    ];
    for (const candidate of candidates) {
      try {
        const content = readFileSync(candidate, 'utf8');
        log('Loaded template', filename, 'from', candidate);
        return content;
      } catch (e) {
        // try next candidate
      }
    }
    throw new Error('Could not find ' + filename + ' in any of: ' + candidates.join(', '));
  }

  let notificationHtml, confirmationHtml;
  try {
    notificationHtml = readTemplate('chatbot-lead-notification.html');
    confirmationHtml = readTemplate('chatbot-lead-confirmation.html');
  } catch (e) {
    // Full detail (paths, cwd) goes to server logs only; the client gets a
    // generic message so internal filesystem layout isn't disclosed.
    logError('Failed to read email templates:', e.message, '__dirname=', __dirname, 'cwd=', process.cwd());
    return res.status(500).json({ error: 'Email service temporarily unavailable' });
  }

  const notificationMsg = {
    to: NOTIFY_TO,
    from: FROM_EMAIL,
    subject: 'New Chatbot Lead: ' + lead.name,
    html: fillTemplate(notificationHtml, lead),
  };

  const confirmationMsg = {
    to: lead.email,
    from: CONFIRMATION_FROM_EMAIL,
    subject: 'Thanks for reaching out to The Demski Group',
    html: fillTemplate(confirmationHtml, {
      user_name: lead.name,
      user_email: lead.email,
      cta_choice: lead.cta_choice,
    }),
  };

  log('Sending lead notification to', NOTIFY_TO, 'from', FROM_EMAIL);
  log('Sending confirmation to', maskEmail(lead.email), 'from', CONFIRMATION_FROM_EMAIL);

  // Send independently (not Promise.all) so one failing recipient doesn't
  // mask whether the other actually succeeded — both results are reported.
  const [notificationResult, confirmationResult] = await Promise.allSettled([
    sgMail.send(notificationMsg),
    sgMail.send(confirmationMsg),
  ]);

  const notificationOk = notificationResult.status === 'fulfilled';
  const confirmationOk = confirmationResult.status === 'fulfilled';

  if (notificationOk) {
    log('Lead notification email: SENT to', NOTIFY_TO);
  } else {
    logError('Lead notification email: FAILED —', JSON.stringify(describeSendGridError(notificationResult.reason)));
  }

  if (confirmationOk) {
    log('User confirmation email: SENT to', maskEmail(lead.email));
  } else {
    logError('User confirmation email: FAILED —', JSON.stringify(describeSendGridError(confirmationResult.reason)));
  }

  // Client responses carry only the boolean send status — the underlying
  // SendGrid error detail is already in the server logs above (lines
  // logError'd per-recipient) and is not echoed to the browser. The widget
  // only reads ok/notificationSent/confirmationSent, so this is behaviorally
  // identical to before for users.
  if (!notificationOk && !confirmationOk) {
    log('Final API response: 502, both emails failed');
    return res.status(502).json({
      ok: false,
      error: 'Failed to send emails',
    });
  }

  // Successful submission (at least one email delivered) — forward the full
  // lead to Zapier. Fire-and-forget: sendToZapier never throws and is not
  // awaited, so it cannot delay or fail the API response below.
  sendToZapier(lead);

  if (!notificationOk || !confirmationOk) {
    log('Final API response: 207, partial success');
    return res.status(207).json({
      ok: false,
      notificationSent: notificationOk,
      confirmationSent: confirmationOk,
    });
  }

  log('Final API response: 200, both emails sent');
  return res.status(200).json({ ok: true, notificationSent: true, confirmationSent: true });
}
