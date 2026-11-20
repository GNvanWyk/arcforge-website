/**
 * Cloudflare Pages Function: POST /api/quote
 *
 * Receives the homepage quote form (multipart/form-data, sent by
 * initQuoteForm in script.js) and sends two emails through the Resend REST
 * API (no SDK, no build step):
 *
 *   1. Notification to ArcForge  - template "quote-request-notification",
 *      reply_to = the client, with the uploaded drawing attached.
 *   2. Confirmation to the client - template "quote-request-confirmation"
 *      (never has the drawing attached).
 *
 * If the notification fails, the visitor gets an error and can try again.
 * If only the confirmation fails, the visitor still gets success, because
 * ArcForge already has the request. Nothing is stored on the server, and
 * only Resend email IDs and error messages are logged (no client details).
 *
 * Resend's docs don't confirm that attachments work together with a
 * template. So when a drawing is attached and Resend rejects the template
 * send as invalid, the notification goes out once more as a plain HTML/text
 * email built here with the same fields, with the drawing attached.
 *
 * Settings (Cloudflare dashboard -> Pages project -> Settings ->
 * Variables and Secrets; locally in a .dev.vars file, which is git-ignored):
 *   RESEND_API_KEY        required, secret. Never put it in a committed file.
 *   TURNSTILE_SECRET_KEY  required, secret. Cloudflare Turnstile secret for
 *                         the widget on the quote form (site key is in index.html).
 *
 * Order of checks: honeypot, then Turnstile, then field validation, then Resend.
 *
 * Senders must be on mail.arcforgedesigns.co.za (the domain verified in
 * Resend). Never use the bare arcforgedesigns.co.za domain, which is Zoho Mail.
 *
 * Needs the nodejs_compat flag (wrangler.jsonc) for Buffer, which base64-
 * encodes the attachment natively instead of in a slow JS loop.
 */
import { Buffer } from 'node:buffer';

const RESEND_URL = 'https://api.resend.com/emails';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const NOTIFY_TO = 'gean@arcforgedesigns.co.za';
const NOTIFY_FROM = 'ArcForge Website <quotes@mail.arcforgedesigns.co.za>';
const CONFIRM_FROM = 'ArcForge Designs <quotes@mail.arcforgedesigns.co.za>';
const NOTIFY_TEMPLATE = 'quote-request-notification';
const CONFIRM_TEMPLATE = 'quote-request-confirmation';
const NOT_GIVEN = 'Not given';

// Keep in sync with the upload hint and accept="" on the form in index.html,
// and QUOTE_MAX_FILE_BYTES in script.js. 25 MB is about 34 MB once base64-
// encoded, which is under Resend's 40 MB per-email attachment limit.
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024; // file + form fields
const ALLOWED_EXTENSIONS = ['dxf', 'dwg', 'svg', 'pdf', 'png', 'jpg', 'jpeg'];

// Field length caps (characters)
const MAX_NAME = 200;
const MAX_EMAIL = 254;
const MAX_PHONE = 50;
const MAX_MESSAGE = 5000;

// Keep in sync with the #service-type <option> values in index.html
const SERVICES = {
  'cnc-cutting': 'CNC Plasma Cutting (Direct from DXF / Vector)',
  'cad-file-prep': 'CAD File Prep & Vectorization (Design / File Cleanup)',
  'full-fabrication': 'Full Fabrication (Cutting, Welding & Assembly)',
  other: 'Other (General Enquiry / Message)',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    console.error('quote: RESEND_API_KEY is not set');
    return json({ ok: false, error: 'not-configured' }, 500);
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: 'file-too-large' }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid' }, 400);
  }

  // Spam trap: this field is hidden from people, so anything in it is a bot.
  // Pretend it worked (and send nothing) so the bot has no reason to retry.
  if (text(form.get('company-website'))) {
    return json({ ok: true });
  }

  // Cloudflare Turnstile: verify the widget's token before anything is sent.
  // Never skipped: without the secret the form is reported as not configured.
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error('quote: TURNSTILE_SECRET_KEY is not set');
    return json({ ok: false, error: 'not-configured' }, 500);
  }
  const token = text(form.get('cf-turnstile-response'), 2048);
  if (!token) {
    return json({ ok: false, error: 'security-check' }, 400);
  }
  let verification;
  try {
    const verify = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || '',
        idempotency_key: crypto.randomUUID(),
      }),
    });
    verification = await verify.json();
  } catch (err) {
    console.error('quote: could not reach Turnstile', err && err.message);
    return json({ ok: false, error: 'send-failed' }, 502);
  }
  if (!verification || verification.success !== true) {
    console.warn('quote: Turnstile check failed', (verification && verification['error-codes']) || []);
    return json({ ok: false, error: 'security-check' }, 400);
  }

  const name = text(form.get('name'), MAX_NAME);
  const email = text(form.get('email'), MAX_EMAIL);
  const phone = text(form.get('phone'), MAX_PHONE);
  const service = text(form.get('service-type'), 50);
  const message = text(form.get('project-details'), MAX_MESSAGE, true);
  const termsAccepted = Boolean(form.get('terms-agree'));

  if (!email) return json({ ok: false, error: 'missing-email' }, 400);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'invalid-email' }, 400);
  if (!name) return json({ ok: false, error: 'missing-name' }, 400);
  if (!SERVICES[service] || !message || !termsAccepted) {
    return json({ ok: false, error: 'invalid' }, 400);
  }

  const isGeneral = service === 'other';
  const file = form.get('drawing-file');
  let attachment = null;

  if (!isGeneral && file && typeof file !== 'string' && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return json({ ok: false, error: 'file-too-large' }, 413);
    }
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return json({ ok: false, error: 'file-type' }, 415);
    }
    attachment = {
      filename: safeFilename(file.name, extension),
      content: Buffer.from(await file.arrayBuffer()).toString('base64'),
    };
  }

  // The templates insert variables unescaped ({{{ }}}), so strip HTML tags'
  // angle brackets from visitor input before it goes into an email.
  const vars = {
    CLIENT_NAME: safe(name),
    CLIENT_EMAIL: safe(email),
    CLIENT_PHONE: safe(phone) || NOT_GIVEN,
    SERVICE: safe(SERVICES[service]),
    MESSAGE: safe(message) || NOT_GIVEN,
  };

  const submissionId = crypto.randomUUID();
  const send = (payload, key) => sendEmail(env.RESEND_API_KEY, payload, key);

  // 1. Notification to ArcForge (must succeed)
  const notifyBase = {
    from: NOTIFY_FROM,
    to: [NOTIFY_TO],
    reply_to: email,
  };
  if (attachment) notifyBase.attachments = [attachment];

  let notify = await send(
    { ...notifyBase, template: { id: NOTIFY_TEMPLATE, variables: vars } },
    `quote-notify/${submissionId}`,
  );

  if (notify.error && attachment && notify.status >= 400 && notify.status < 500 && notify.status !== 429) {
    // Resend may not accept attachments with a template: send the same
    // fields as our own email instead (a new key, since the payload differs).
    console.warn('quote: template notification with attachment rejected, sending own email', notify.status, notify.error);
    notify = await send(
      {
        ...notifyBase,
        subject: `New quote request: ${vars.SERVICE} from ${vars.CLIENT_NAME}`,
        html: notificationHtml(vars, attachment.filename),
        text: notificationText(vars, attachment.filename),
      },
      `quote-notify/${submissionId}/own`,
    );
  }

  if (notify.error) {
    console.error('quote: notification failed', notify.status, notify.error);
    return json({ ok: false, error: 'send-failed' }, 502);
  }
  console.log('quote: notification sent', notify.id);

  // 2. Confirmation to the client (best effort; never has the attachment)
  const confirm = await send(
    {
      from: CONFIRM_FROM,
      to: [email],
      reply_to: NOTIFY_TO,
      template: {
        id: CONFIRM_TEMPLATE,
        variables: { CLIENT_NAME: vars.CLIENT_NAME, SERVICE: vars.SERVICE },
      },
    },
    `quote-confirm/${submissionId}`,
  );

  if (confirm.error) {
    console.error('quote: confirmation failed', confirm.status, confirm.error);
  } else {
    console.log('quote: confirmation sent', confirm.id);
  }

  return json({ ok: true });
}

/**
 * POST one email to Resend. Never throws: resolves to { id } on success or
 * { error, status } on failure. Retries once on a network error or 5xx with
 * the same idempotency key, so a retry can't send a duplicate.
 */
async function sendEmail(apiKey, payload, idempotencyKey) {
  const body = JSON.stringify(payload);
  let last = { error: 'unknown error', status: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body,
      });
    } catch (err) {
      last = { error: `network: ${(err && err.message) || 'fetch failed'}`, status: 0 };
      continue;
    }

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.id) return { id: data.id };

    last = { error: (data && data.message) || `HTTP ${response.status}`, status: response.status };
    if (response.status < 500) break; // 4xx won't get better on retry
  }

  return last;
}

/** Trimmed string form value, capped at max characters; '' for files/missing. */
function text(value, max = 500, multiline = false) {
  if (typeof value !== 'string') return '';
  let s = value.trim();
  if (!multiline) s = s.replace(/\s+/g, ' ');
  return s.slice(0, max);
}

/** Escape < and > so visitor input can't add HTML to an email. */
function safe(value) {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Attachment name without path parts or odd characters, keeping the extension. */
function safeFilename(name, extension) {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
    .slice(0, 100);
  return `${base || 'drawing'}.${extension}`;
}

/* Fallback notification (same fields as the quote-request-notification
   template), used only if Resend rejects a template send with an attachment. */
function notificationHtml(v, filename) {
  const row = (label, value) =>
    `<tr><td width="120" style="padding:0 0 8px;font:15px/22px Arial,Helvetica,sans-serif;color:#666666;">${label}</td>` +
    `<td style="padding:0 0 8px;font:15px/22px Arial,Helvetica,sans-serif;color:#222222;">${value}</td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#f4f4f4;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
<tr><td style="background:#1f1f1f;padding:20px 24px;font:bold 20px/26px Arial,Helvetica,sans-serif;color:#ffffff;">New quote request</td></tr>
<tr><td style="padding:24px 24px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0">
${row('Name', v.CLIENT_NAME)}${row('Email', v.CLIENT_EMAIL)}${row('Phone', v.CLIENT_PHONE)}${row('Service', v.SERVICE)}${row('Drawing', `${safe(filename)} (attached)`)}
</table></td></tr>
<tr><td style="padding:8px 24px 0;font:15px/22px Arial,Helvetica,sans-serif;color:#666666;">Message</td></tr>
<tr><td style="padding:4px 24px 24px;font:15px/22px Arial,Helvetica,sans-serif;color:#222222;white-space:pre-wrap;">${v.MESSAGE}</td></tr>
<tr><td style="padding:0 24px 24px;font:13px/18px Arial,Helvetica,sans-serif;color:#888888;">Hit Reply to answer the client directly.</td></tr>
</table></body></html>`;
}

function notificationText(v, filename) {
  return [
    'New quote request',
    '',
    `Name:     ${v.CLIENT_NAME}`,
    `Email:    ${v.CLIENT_EMAIL}`,
    `Phone:    ${v.CLIENT_PHONE}`,
    `Service:  ${v.SERVICE}`,
    `Drawing:  ${filename} (attached)`,
    '',
    'Message:',
    v.MESSAGE,
    '',
    'Hit Reply to answer the client directly.',
  ].join('\n');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
