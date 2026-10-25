const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const argToken = process.argv[2];

function saveToken(rawToken) {
  const token = (rawToken || '').trim();
  if (!token || !token.includes(':')) {
    console.error('❌ Ошибка: Токен Telegram должен содержать двоеточие (например: 123456789:AAH...).');
    process.exit(1);
  }

  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l.trim() !== '' && !l.startsWith('TELEGRAM_BOT_TOKEN='));
  }

  lines.push(`TELEGRAM_BOT_TOKEN=${token}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\n✅ TELEGRAM_BOT_TOKEN успешно сохранен в .env! (длина: ${token.length} симв., ID бота: ${token.split(':')[0]})`);
  process.exit(0);
}

if (argToken) {
  saveToken(argToken);
} else {
  rl.question('\n👉 Вставьте ваш TELEGRAM_BOT_TOKEN и нажмите Enter: ', (answer) => {
    rl.close();
    saveToken(answer);
  });
}
