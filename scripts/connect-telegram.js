const fs = require('fs');
const path = require('path');
const {
  pollTelegramBotUpdates,
  registerBotMenuCommands,
  PERSISTENT_BOTTOM_KEYBOARD,
  callTelegramApi,
  buildMainMenuText,
  getMainMenuKeyboard
} = require('../server/telegram');
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

  // 1. Register native Telegram [ ☰ Menu ] button & commands
  await registerBotMenuCommands();
  console.log('✅ Registered native Telegram [ ☰ Menu ] button (/menu, /status, /summary).');

  // 2. Process any pending updates
  await pollTelegramBotUpdates();

  // 3. Send persistent bottom reply keyboard + inline Control Center menu to subscribers
  const subs = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id != 'admin_profile' AND active = 1`).all();
  for (const sub of subs) {
    await callTelegramApi('sendMessage', {
      chat_id: sub.chat_id,
      text: '👇 <b>Закреплена постоянная нижняя панель кнопок!</b>\nТеперь вы можете в любой момент нажать <b>«🛡 Меню настроек»</b>, <b>«🔍 Узнать статус страны»</b> или <b>«📊 Сводка L4 & L5»</b> прямо над строкой ввода сообщения (или через синюю кнопку <b>Menu</b> слева):',
      parse_mode: 'HTML',
      reply_markup: PERSISTENT_BOTTOM_KEYBOARD
    });
    await callTelegramApi('sendMessage', {
      chat_id: sub.chat_id,
      text: buildMainMenuText(sub),
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard(sub)
    });
    console.log(`📨 Sent persistent bottom menu bar to chat ${sub.chat_id}!`);
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
