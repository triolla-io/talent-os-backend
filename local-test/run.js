#!/usr/bin/env node
/**
 * Local manual test runner for the Talent-OS email intake flow.
 *
 * Usage:
 *   node local-test/run.js                     # send all files in local-test/files/
 *   node local-test/run.js cv.pdf              # send a specific file from local-test/files/
 *   node local-test/run.js --health            # just check health endpoint
 *
 * Prerequisites:
 *   - docker compose up --build (API on port 3000)
 *   - docker compose exec api npx prisma db seed  (tenant + job must exist)
 *   - MAILGUN_WEBHOOK_SIGNING_KEY set in .env (or exported in your shell)
 *
 * After running, open Prisma Studio and check:
 *   1. email_intake_log  → processing_status should go pending → success
 *   2. candidates        → extracted fields from the CV
 *   3. applications      → linked to the job
 *   4. candidate_job_scores → AI score + reasoning
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');

// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE_URL = 'http://localhost:3000';
const SIGNING_KEY = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? 'dev-signing-key-change-me';
const SENDER_EMAIL = 'agency@test-recruiter.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMailgunSignature(signingKey, timestamp, token) {
  return crypto
    .createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex');
}

function randomToken() {
  return crypto.randomBytes(25).toString('hex'); // 50 hex chars
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] ?? 'application/octet-stream';
}

function buildMessageHeaders(messageId) {
  return JSON.stringify([
    ['Message-Id', `<${messageId}>`],
    ['From', SENDER_EMAIL],
    ['Mime-Version', '1.0'],
  ]);
}

async function checkHealth() {
  console.log('\n🏥  Checking system health...');
  const res = await fetch(`${API_BASE_URL}/api/webhooks/health`);
  const body = await res.json();
  if (res.ok) {
    console.log(`✅  Health OK →`, body);
  } else {
    console.error(`❌  Health DEGRADED [${res.status}] →`, body);
  }
  return res.ok;
}

async function sendWebhook(filename, fileBuffer) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = randomToken();
  const signature = buildMailgunSignature(SIGNING_KEY, timestamp, token);
  const messageId = `test-${Date.now()}-${token.slice(0, 8)}@local.test`;
  const candidateName = path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' ');
  const contentType = getContentType(filename);

  console.log(`\n📤  Sending: ${filename}`);
  console.log(`    MessageID : ${messageId}`);
  console.log(`    From      : ${SENDER_EMAIL}`);
  console.log(`    Size      : ${(fileBuffer.length / 1024).toFixed(1)} KB`);

  const form = new FormData();
  form.append('timestamp', timestamp);
  form.append('token', token);
  form.append('signature', signature);
  form.append('from', SENDER_EMAIL);
  form.append('recipient', 'fun@mg.triolla.io');
  form.append('subject', `CV - ${candidateName}`);
  form.append('body-plain', `Hi,\n\nPlease find my CV attached.\n\nBest regards,\n${candidateName}`);
  form.append('message-headers', buildMessageHeaders(messageId));
  form.append('attachment-1', fileBuffer, { filename, contentType });

  const res = await fetch(`${API_BASE_URL}/api/webhooks/email`, {
    method: 'POST',
    headers: form.getHeaders(),
    body: form,
  });

  const responseText = await res.text();

  if (res.ok) {
    console.log(`✅  Accepted [${res.status}] → ${responseText}`);
    console.log(`\n    👉 Now watch docker compose logs -f worker for processing.`);
    console.log(`    👉 Then refresh Prisma Studio → email_intake_log to see the result.`);
    console.log(`    👉 MessageID to search for: ${messageId}`);
  } else {
    console.error(`❌  Rejected [${res.status}] → ${responseText}`);
  }

  return { ok: res.ok, messageId };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const filesDir = path.join(__dirname, 'files');

  if (args.includes('--health')) {
    await checkHealth();
    return;
  }

  const healthy = await checkHealth();
  if (!healthy) {
    console.error('\n⛔  Service degraded — fix health issues before running tests.');
    process.exit(1);
  }

  let filesToSend = [];

  if (args.length > 0 && !args[0].startsWith('--')) {
    const targetFile = path.join(filesDir, args[0]);
    if (!fs.existsSync(targetFile)) {
      console.error(`❌  File not found: ${targetFile}`);
      process.exit(1);
    }
    filesToSend = [args[0]];
  } else {
    if (!fs.existsSync(filesDir)) {
      console.error(`❌  Directory not found: ${filesDir}`);
      console.error(`    Create it and place CV files inside (PDF, DOC, DOCX).`);
      process.exit(1);
    }
    const supported = ['.pdf', '.doc', '.docx'];
    filesToSend = fs.readdirSync(filesDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return supported.includes(ext) && !f.startsWith('.');
    });

    if (filesToSend.length === 0) {
      console.error(`❌  No CV files found in ${filesDir}`);
      console.error(`    Drop some PDF / DOC / DOCX files there and try again.`);
      process.exit(1);
    }
  }

  console.log(`\n📂  Files to send: ${filesToSend.join(', ')}`);

  const results = [];
  for (const filename of filesToSend) {
    const filePath = path.join(filesDir, filename);
    const fileBuffer = fs.readFileSync(filePath);
    const result = await sendWebhook(filename, fileBuffer);
    results.push({ filename, ...result });
    if (filesToSend.indexOf(filename) < filesToSend.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log('\n─────────────────────────────────────────────');
  console.log('📊 Summary:');
  results.forEach(({ filename, ok, messageId }) => {
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon}  ${filename.padEnd(40)} MessageID: ${messageId}`);
  });
  console.log('─────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('💥 Unexpected error:', err.message);
  process.exit(1);
});
