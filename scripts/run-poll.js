#!/usr/bin/env node
/**
 * Standalone CLI / GitHub Actions Cron Runner for GEOAlerts
 * Polls all 8 diplomatic, embassy, aviation, maritime, and UN sources,
 * computes text diffs, calls OpenAI gpt-4.1-mini ONLY on changed wording,
 * and dispatches Level 4 (Red) & Level 5 (Black) alerts to Telegram.
 * (Interactive bot commands/buttons are handled 24/7 by Cloudflare Worker Webhook).
 */
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const { runFullIngestion } = require('../server/parsers');

(async () => {
  console.log('[GEOAlerts Cron] Starting global multi-source intelligence poll...');
  const result = await runFullIngestion({ sendTelegramAlerts: true });
  console.log('[GEOAlerts Cron] Completed:', JSON.stringify(result, null, 2));
  process.exit(0);
})();
