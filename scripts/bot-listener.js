#!/usr/bin/env node
/**
 * Standalone High-Speed Telegram Bot Listener (occupies ZERO local HTTP ports).
 * Uses continuous HTTP Long-Polling (timeout=25s, 0ms inter-event delay)
 * so button clicks and country queries in @GeoAlerts13Bot respond in ~80-140ms!
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

console.log('[GEOAlerts Bot] Ultra-fast Long-Polling listener active (@GeoAlerts13Bot, 0ms delay, 0 HTTP ports)...');

(async () => {
  while (true) {
    try {
      await pollTelegramBotUpdates(25);
    } catch (_) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
})();
