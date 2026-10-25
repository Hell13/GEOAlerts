#!/usr/bin/env node
/**
 * Standalone Telegram Bot Listener (occupies ZERO local HTTP ports).
 * Listens for button clicks & country lookups in @GeoAlerts13Bot in real time.
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

const { pollTelegramBotUpdates } = require('../server/telegram');

console.log('[GEOAlerts Bot] Real-time Telegram Bot listener active (@GeoAlerts13Bot, 0 HTTP ports used)...');

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await pollTelegramBotUpdates();
  } catch (_) {
  } finally {
    busy = false;
  }
}, 1500);
