const fs = require('fs');
const path = require('path');
const { pollTelegramBotUpdates, callTelegramApi, getMainMenuKeyboard } = require('../server/telegram');
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
  console.log(`🔗 Bot link: https://t.me/${botUser.username}`);

  // 2. Process any incoming /start or messages via getUpdates
  const processed = await pollTelegramBotUpdates();
  console.log(`📥 Processed ${processed} incoming Telegram updates.`);

  // 3. Check registered subscribers in DB
  const subs = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id != 'admin_profile' AND active = 1`).all();
  if (subs.length === 0) {
    console.log('⏳ Пока нет активных чатов. Откройте https://t.me/' + botUser.username + ' и нажмите START (/start).');
  } else {
    for (const sub of subs) {
      console.log(`✅ Подписан чат ID: ${sub.chat_id} (@${sub.username || sub.first_name}) | Режим: ${sub.mode}`);
      await callTelegramApi('sendMessage', {
        chat_id: sub.chat_id,
        text:
          `🛡 <b>GEOAlerts Early Warning System Connected!</b>\n\n` +
          `Ваш чат (<code>${sub.chat_id}</code>) успешно привязан к глобальному радару дипломатических и авиационных предупреждений (203 страны, 8 источников, ИИ-модель <code>gpt-4.1-mini</code>).\n\n` +
          `🔇 <b>Фильтр тишины активен:</b> Уровни 1, 2 и 3 сохраняются только на веб-карте.\n` +
          `🚨 <b>Тревоги в этот чат:</b> Только <b>Level 4 (Red Flag / Pre-Evacuation)</b> и <b>Level 5 (Imminent Crisis / Ordered Departure)</b>.\n\n` +
          `👇 Выберите режим мониторинга кнопками ниже:`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      });
      console.log(`📨 Отправлено приветственное меню управления в Telegram чат ${sub.chat_id}!`);
    }
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
