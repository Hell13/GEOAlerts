const fs = require('fs');
const path = require('path');
const { pollTelegramBotUpdates, callTelegramApi, buildMainMenuText, getMainMenuKeyboard } = require('../server/telegram');
const { db } = require('../server/db');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

async function run() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN is empty in .env');
    process.exit(1);
  }

  // 1. Check bot identity via getMe
  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const meData = await meRes.json();
  if (!meData.ok) {
    console.error('❌ Invalid Telegram token:', meData.description);
    process.exit(1);
  }
  const botUser = meData.result;
  console.log(`🤖 Bot verified: @${botUser.username} (${botUser.first_name}, ID: ${botUser.id})`);

  // 2. Process any pending button clicks or messages
  const processed = await pollTelegramBotUpdates();
  console.log(`📥 Processed ${processed} pending Telegram updates.`);

  // 3. Send updated Control Center menu to active subscribers
  const subs = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id != 'admin_profile' AND active = 1`).all();
  for (const sub of subs) {
    await callTelegramApi('sendMessage', {
      chat_id: sub.chat_id,
      text: buildMainMenuText(sub),
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard(sub)
    });
    console.log(`📨 Sent updated Control Center menu to chat ${sub.chat_id}!`);
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
