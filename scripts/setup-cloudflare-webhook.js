const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/TELEGRAM_BOT_TOKEN=(.+)/);
if (!match) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}
const token = match[1].trim();
const workerWebhookUrl = 'https://geoalerts-telegram-bot.geoalerts.workers.dev/webhook';

(async () => {
  console.log('1. Uploading TELEGRAM_BOT_TOKEN secret to Cloudflare Worker...');
  const proc = spawnSync('/opt/homebrew/bin/npx', ['wrangler', 'secret', 'put', 'TELEGRAM_BOT_TOKEN'], {
    input: token,
    encoding: 'utf8',
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
  });
  console.log(proc.stdout || proc.stderr);

  console.log('2. Registering Webhook URL with Telegram Bot API...');
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: workerWebhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false
    })
  });
  const setData = await res.json();
  console.log('setWebhook response:', JSON.stringify(setData));

  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const infoData = await infoRes.json();
  console.log('3. Verified Webhook Info:', JSON.stringify(infoData.result, null, 2));
})();
