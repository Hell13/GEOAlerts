/**
 * GEOAlerts 24/7 Cloud Telegram Bot Webhook Worker (Cloudflare Workers / Edge)
 * Responds in <50ms from the cloud with ZERO processes running on the user's computer!
 */

const DATA_BASE_URL = 'https://geoalerts.inteligentevolutionplatform.com/data';

const REGIONS = {
  'Middle East': ['IL', 'PS', 'LB', 'IR', 'IQ', 'SY', 'YE', 'JO', 'EG', 'SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'TR'],
  'Europe & East': ['UA', 'RU', 'BY', 'MD', 'PL', 'LT', 'LV', 'EE', 'FI', 'RS', 'XK', 'BA', 'GE', 'AM', 'AZ', 'DE', 'FR', 'GB', 'CY'],
  'Asia-Pacific': ['TW', 'CN', 'KP', 'KR', 'JP', 'PH', 'MM', 'AF', 'PK', 'IN', 'BD', 'TH', 'VN', 'ID', 'SG'],
  'Africa': ['SD', 'SS', 'ET', 'SO', 'CD', 'ML', 'NE', 'BF', 'LY', 'TD', 'CF', 'NG', 'MZ', 'KE', 'ZA'],
  'Americas': ['VE', 'HT', 'CU', 'MX', 'CO', 'EC', 'NI', 'HN', 'US', 'CA', 'BR', 'AR']
};

const CUSTOM_ALIASES = {
  'оаэ': 'AE', 'uae': 'AE', 'дубай': 'AE', 'dubai': 'AE', 'эмираты': 'AE',
  'сша': 'US', 'usa': 'US', 'америка': 'US', 'america': 'US',
  'великобритания': 'GB', 'англия': 'GB', 'uk': 'GB', 'britain': 'GB',
  'южная корея': 'KR', 'корея': 'KR', 'south korea': 'KR',
  'северная корея': 'KP', 'кндр': 'KP', 'north korea': 'KP',
  'россия': 'RU', 'рф': 'RU', 'russia': 'RU',
  'украина': 'UA', 'ukraine': 'UA',
  'израиль': 'IL', 'israel': 'IL',
  'палестина': 'PS', 'газа': 'PS', 'gaza': 'PS',
  'тайвань': 'TW', 'taiwan': 'TW',
  'иран': 'IR', 'iran': 'IR',
  'ливан': 'LB', 'lebanon': 'LB',
  'сирия': 'SY', 'syria': 'SY',
  'турция': 'TR', 'turkey': 'TR',
  'египет': 'EG', 'egypt': 'EG',
  'кипр': 'CY', 'cyprus': 'CY',
  'таиланд': 'TH', 'тайланд': 'TH', 'thailand': 'TH',
  'сербия': 'RS', 'serbia': 'RS',
  'косово': 'XK', 'kosovo': 'XK',
  'молдова': 'MD', 'молдавия': 'MD', 'moldova': 'MD',
  'грузия': 'GE', 'georgia': 'GE',
  'армения': 'AM', 'armenia': 'AM',
  'азербайджан': 'AZ', 'azerbaijan': 'AZ',
  'польша': 'PL', 'poland': 'PL'
};

const LEVEL_BADGES = {
  5: '⚫️ LEVEL 5 — CRITICAL / IMMINENT CRISIS',
  4: '🔴 LEVEL 4 — RED FLAG / PRE-EVACUATION',
  3: '🟠 LEVEL 3 — HIGH RISK / RECONSIDER TRAVEL',
  2: '🟡 LEVEL 2 — INCREASED CAUTION',
  1: '🟢 LEVEL 1 — NORMAL PRECAUTIONS'
};

const SOURCE_ICONS = {
  'us_state_dept': '🇺🇸',
  'us_embassy_alert': '🏛',
  'uk_fcdo': '🇬🇧',
  'il_nsc': '🇮🇱',
  'ca_global_affairs': '🇨🇦',
  'de_auswaertiges_amt': '🇩🇪',
  'aviation_safeairspace': '✈️',
  'maritime_nga_un': '⚓️'
};

const PERSISTENT_BOTTOM_KEYBOARD = {
  keyboard: [
    [
      { text: '🛡 Меню настроек' },
      { text: '🔍 Узнать статус страны' },
      { text: '📊 Сводка L4 & L5' }
    ]
  ],
  resize_keyboard: true,
  is_persistent: true
};

let cachedDetails = null;
let cachedAt = 0;

async function getIntelligenceDetails() {
  const now = Date.now();
  if (cachedDetails && now - cachedAt < 180000) {
    return cachedDetails;
  }
  const res = await fetch(`${DATA_BASE_URL}/countries_details.json`, {
    cf: { cacheTtl: 180, cacheEverything: true }
  });
  cachedDetails = await res.json();
  cachedAt = now;
  return cachedDetails;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tgApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

function findCountry(detailsMap, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return null;
  if (CUSTOM_ALIASES[q] && detailsMap[CUSTOM_ALIASES[q]]) {
    return detailsMap[CUSTOM_ALIASES[q]].country;
  }
  if (q.length === 2 && detailsMap[q.toUpperCase()]) {
    return detailsMap[q.toUpperCase()].country;
  }
  const ruNames = new Intl.DisplayNames(['ru'], { type: 'region' });
  for (const [iso2, item] of Object.entries(detailsMap)) {
    const c = item.country;
    const nameLower = c.name.toLowerCase();
    let ruLower = '';
    try { ruLower = (ruNames.of(iso2) || '').toLowerCase(); } catch (_) {}
    if (nameLower === q || ruLower === q || (c.iso3 || '').toLowerCase() === q) {
      return c;
    }
  }
  if (q.length >= 3) {
    const ruNames2 = new Intl.DisplayNames(['ru'], { type: 'region' });
    for (const [iso2, item] of Object.entries(detailsMap)) {
      const c = item.country;
      let ruLower = '';
      try { ruLower = (ruNames2.of(iso2) || '').toLowerCase(); } catch (_) {}
      if (c.name.toLowerCase().includes(q) || ruLower.includes(q)) {
        return c;
      }
    }
  }
  return null;
}

function buildMainMenuText(mode = 'all', selected = ['UA', 'IL', 'LB', 'IR', 'TW']) {
  const modeAll = mode === 'all';
  return (
    `🛡 <b>GEOAlerts — Early Warning Control Center (Cloud 24/7)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📡 <b>Alert Mode:</b> ${modeAll ? '✅ <b>🌍 All Countries Worldwide (Default)</b>' : `✅ <b>⭐ Selected Countries Only (${selected.length})</b>`}\n` +
    `⭐ <b>Your Watchlist (${selected.length}):</b> <code>${selected.join(', ') || 'None'}</code>\n` +
    `🔇 <b>Noise Filter:</b> Levels 1–3 are silenced. Only <b>🔴 Level 4</b> & <b>⚫️ Level 5</b> trigger pushes.\n\n` +
    `💡 <i>Tip: Type any country name in chat (e.g. <code>Israel</code>, <code>Израиль</code>, <code>Taiwan</code>, <code>UA</code>) to instantly inspect its dossier!</i>`
  );
}

function getMainMenuKeyboard(mode = 'all', selected = ['UA', 'IL', 'LB', 'IR', 'TW']) {
  const modeAll = mode === 'all';
  return {
    inline_keyboard: [
      [
        { text: `${modeAll ? '✅ ' : ''}🌍 All Countries (Default)`, callback_data: 'mode:all' },
        { text: `${!modeAll ? '✅ ' : ''}⭐ Selected Only (${selected.length})`, callback_data: 'mode:selected' }
      ],
      [
        { text: '🔍 Check Country Status', callback_data: 'action:lookup_menu' },
        { text: '📊 L4 & L5 Summary', callback_data: 'action:summary' }
      ],
      [
        { text: '⚙️ Edit Watchlist: 🔥 Middle East', callback_data: 'region:Middle East' },
        { text: '⚙️ Europe & East', callback_data: 'region:Europe & East' }
      ],
      [
        { text: '⚙️ Asia-Pacific', callback_data: 'region:Asia-Pacific' },
        { text: '⚙️ Africa', callback_data: 'region:Africa' },
        { text: '⚙️ Americas', callback_data: 'region:Americas' }
      ],
      [
        { text: '❤️ DONATE / Support Project', url: 'https://pay.monobank.ua/2610266gGwa5F3i8tyG6' }
      ]
    ]
  };
}

function getLookupMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔥 Middle East', callback_data: 'lookup_reg:Middle East' },
        { text: '🛡 Europe & East', callback_data: 'lookup_reg:Europe & East' }
      ],
      [
        { text: '🌏 Asia-Pacific', callback_data: 'lookup_reg:Asia-Pacific' },
        { text: '🌍 Africa', callback_data: 'lookup_reg:Africa' },
        { text: '🌎 Americas', callback_data: 'lookup_reg:Americas' }
      ],
      [
        { text: '⬅️ Back to Main Menu', callback_data: 'menu:main' }
      ]
    ]
  };
}

function formatDossier(detailsMap, iso2) {
  const entry = detailsMap[iso2];
  if (!entry) return null;
  const { country, sources } = entry;
  const lvl = country.overall_level || 1;
  const lvlIcon = lvl === 5 ? '⚫️' : lvl === 4 ? '🔴' : lvl === 3 ? '🟠' : lvl === 2 ? '🟡' : '🟢';

  const allFlags = new Set();
  for (const s of sources || []) {
    (s.redFlags || []).forEach(f => allFlags.add(f));
  }

  const sourceLines = (sources || []).map(s => {
    const icon = SOURCE_ICONS[s.source_id] || '📡';
    const sLvl = s.normalized_level || 1;
    const sDot = sLvl === 5 ? '⚫️' : sLvl === 4 ? '🔴' : sLvl === 3 ? '🟠' : sLvl === 2 ? '🟡' : '🟢';
    const shortSnippet = (s.summary || s.title || '').replace(/\s+/g, ' ').trim().slice(0, 115);
    return (
      `${icon} <b>${escapeHtml(s.source_name)}</b> — ${sDot} <b>L${sLvl}</b>\n` +
      `   <i>${escapeHtml(s.raw_level || `Level ${sLvl}`)}</i>\n` +
      (shortSnippet ? `   └ ${escapeHtml(shortSnippet)}${shortSnippet.length >= 115 ? '…' : ''}` : '')
    );
  });

  const flagsBlock = allFlags.size > 0
    ? `\n<b>🚩 Active Red Flags (${allFlags.size}):</b>\n${[...allFlags].slice(0, 6).map(f => `  • <code>${escapeHtml(f)}</code>`).join('\n')}\n`
    : '';

  const text =
    `🌎 <b>COUNTRY INTELLIGENCE DOSSIER: ${escapeHtml(country.name.toUpperCase())} (${iso2})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<b>Composite Status:</b> ${LEVEL_BADGES[lvl] || `${lvlIcon} LEVEL ${lvl}`}\n` +
    `<b>Multi-Agency Resonance:</b> ${country.resonance_count > 0 ? `⚠️ <b>${country.resonance_count} agencies at Level 4+</b>` : `${(sources || []).length} official sources monitored`}\n` +
    `${flagsBlock}\n` +
    `🧠 <b>Executive Summary:</b>\n${escapeHtml(country.ai_executive_summary || 'Standard monitoring active.')}\n\n` +
    `🏛 <b>Status by Each Official Source (${(sources || []).length}):</b>\n\n` +
    (sourceLines.length > 0 ? sourceLines.join('\n\n') : '<i>No active advisories recorded.</i>');

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔍 Check Another Country', callback_data: 'action:lookup_menu' },
        { text: '⬅️ Main Menu', callback_data: 'menu:main' }
      ]
    ]
  };
  return { text, keyboard };
}

function buildSummary(detailsMap) {
  const allCountries = Object.values(detailsMap).map(d => d.country);
  const l5List = allCountries.filter(c => c.overall_level === 5).sort((a, b) => b.resonance_count - a.resonance_count);
  const l4All = allCountries.filter(c => c.overall_level === 4).sort((a, b) => b.resonance_count - a.resonance_count);
  const l4List = l4All.slice(0, 12);

  const l5Str = l5List.map(c => `• <b>${escapeHtml(c.name)}</b> (<code>${c.iso2}</code>) — ${c.resonance_count} src`).join('\n');
  const l4Str = l4List.map(c => `• <b>${escapeHtml(c.name)}</b> (<code>${c.iso2}</code>)`).join('\n');

  return {
    text:
      `📊 <b>Compact Level 4 & 5 Flashpoints</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚫️ <b>Level 5 Critical (${l5List.length}):</b>\n${l5Str || 'None'}\n\n` +
      `🔴 <b>Top Level 4 Red Flag (showing 12 of ${l4All.length}):</b>\n${l4Str || 'None'}\n\n` +
      `💡 <i>Tap <b>🔍 Check Country Status</b> below or type any country name in chat to inspect all 8 sources for a specific country.</i>`,
    keyboard: {
      inline_keyboard: [
        [
          { text: '🔍 Check Country Status', callback_data: 'action:lookup_menu' },
          { text: '⬅️ Main Menu', callback_data: 'menu:main' }
        ]
      ]
    }
  };
}

export default {
  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return new Response('Missing TELEGRAM_BOT_TOKEN secret', { status: 500 });
    }

    const url = new URL(request.url);
    if (url.pathname === '/register-webhook') {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await tgApi(token, 'setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query']
      });
      return new Response(JSON.stringify({ webhookUrl, telegramResponse: res }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'POST') {
      return new Response('GEOAlerts Telegram Cloud Webhook is active 24/7!', { status: 200 });
    }

    try {
      const update = await request.json();
      const detailsMap = await getIntelligenceDetails();

      if (update.message) {
        const msg = update.message;
        const chatId = String(msg.chat.id);
        const text = (msg.text || '').trim();
        const textLower = text.toLowerCase();
        if (!text) return new Response('OK');

        if (
          text.startsWith('/start') ||
          text.startsWith('/settings') ||
          text.startsWith('/menu') ||
          text === '🛡 Меню настроек' ||
          textLower === 'меню' ||
          textLower === 'menu'
        ) {
          if (text.startsWith('/start')) {
            await tgApi(token, 'sendMessage', {
              chat_id: chatId,
              text: '⌨️ <b>Нижняя панель быстрого вызова меню закреплена!</b> Используйте кнопки внизу экрана в любой момент:',
              parse_mode: 'HTML',
              reply_markup: PERSISTENT_BOTTOM_KEYBOARD
            });
          }
          await tgApi(token, 'sendMessage', {
            chat_id: chatId,
            text: buildMainMenuText('all'),
            parse_mode: 'HTML',
            reply_markup: getMainMenuKeyboard('all')
          });
          return new Response('OK');
        }

        if (
          text === '/status' ||
          text === '🔍 Узнать статус страны' ||
          textLower === 'статус' ||
          textLower === 'узнать статус страны'
        ) {
          await tgApi(token, 'sendMessage', {
            chat_id: chatId,
            text:
              `🔍 <b>Check Country Intelligence Status</b>\n\n` +
              `1️⃣ <b>By Text:</b> Simply type and send any country name or ISO code right into this chat (in Russian or English, e.g. <code>Израиль</code>, <code>Taiwan</code>, <code>Таиланд</code>, <code>UA</code>).\n\n` +
              `2️⃣ <b>From List:</b> Or choose a region below to pick a country with one tap:`,
            parse_mode: 'HTML',
            reply_markup: getLookupMenuKeyboard()
          });
          return new Response('OK');
        }

        if (text.startsWith('/summary') || text === '📊 Сводка L4 & L5' || textLower === 'сводка') {
          const sum = buildSummary(detailsMap);
          await tgApi(token, 'sendMessage', {
            chat_id: chatId,
            text: sum.text,
            parse_mode: 'HTML',
            reply_markup: sum.keyboard
          });
          return new Response('OK');
        }

        const queryStr = text.replace(/^\/(status|check|country)\s*/i, '').trim();
        const matched = findCountry(detailsMap, queryStr);
        if (matched) {
          const dossier = formatDossier(detailsMap, matched.iso2);
          await tgApi(token, 'sendMessage', {
            chat_id: chatId,
            text: dossier.text,
            parse_mode: 'HTML',
            reply_markup: dossier.keyboard
          });
          return new Response('OK');
        }

        await tgApi(token, 'sendMessage', {
          chat_id: chatId,
          text: `❓ Country <b>"${escapeHtml(queryStr)}"</b> not found.\n\nType any country name in English or Russian (e.g. <code>Israel</code>, <code>Израиль</code>, <code>Taiwan</code>, <code>Thailand</code>) or select from a region below:`,
          parse_mode: 'HTML',
          reply_markup: getLookupMenuKeyboard()
        });
        return new Response('OK');
      }

      if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = String(cb.message.chat.id);
        const messageId = cb.message.message_id;
        const data = cb.data || '';
        let toastText = '✅ Updated';
        let editPayload = null;

        if (data === 'mode:all' || data === 'mode:selected') {
          const newMode = data.split(':')[1];
          toastText = newMode === 'all' ? '🌍 Mode: All Countries Worldwide active!' : '⭐ Mode: Selected Countries Only active!';
          editPayload = {
            chat_id: chatId,
            message_id: messageId,
            text: buildMainMenuText(newMode),
            parse_mode: 'HTML',
            reply_markup: getMainMenuKeyboard(newMode)
          };
        } else if (data === 'action:lookup_menu') {
          toastText = '🔍 Select a region or type a country name';
          editPayload = {
            chat_id: chatId,
            message_id: messageId,
            text:
              `🔍 <b>Check Country Intelligence Status</b>\n\n` +
              `1️⃣ <b>By Text:</b> Simply type and send any country name or ISO code right into this chat (in Russian or English, e.g. <code>Израиль</code>, <code>Taiwan</code>, <code>Таиланд</code>, <code>UA</code>).\n\n` +
              `2️⃣ <b>From List:</b> Or choose a region below to pick a country with one tap:`,
            parse_mode: 'HTML',
            reply_markup: getLookupMenuKeyboard()
          };
        } else if (data.startsWith('lookup_reg:') || data.startsWith('region:')) {
          const regionName = data.replace(/^(lookup_reg:|region:)/, '');
          toastText = `📍 ${regionName}`;
          const isoList = REGIONS[regionName] || [];
          const rows = [];
          let currentRow = [];
          for (const iso2 of isoList) {
            const c = detailsMap[iso2]?.country;
            const name = c?.name || iso2;
            const lvl = c?.overall_level || 1;
            const dot = lvl === 5 ? '⚫️' : lvl === 4 ? '🔴' : lvl === 3 ? '🟠' : lvl === 2 ? '🟡' : '🟢';
            currentRow.push({ text: `${dot} ${name} (L${lvl})`, callback_data: `dossier:${iso2}` });
            if (currentRow.length === 2) { rows.push(currentRow); currentRow = []; }
          }
          if (currentRow.length > 0) rows.push(currentRow);
          rows.push([{ text: '⬅️ Back to Regions', callback_data: 'action:lookup_menu' }, { text: '🏠 Main Menu', callback_data: 'menu:main' }]);

          editPayload = {
            chat_id: chatId,
            message_id: messageId,
            text: `📍 <b>${escapeHtml(regionName)} — Select a Country to View Full Dossier:</b>`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: rows }
          };
        } else if (data.startsWith('dossier:')) {
          const iso2 = data.slice(8);
          const dossier = formatDossier(detailsMap, iso2);
          toastText = `🌎 Loaded dossier for ${iso2}`;
          if (dossier) {
            editPayload = {
              chat_id: chatId,
              message_id: messageId,
              text: dossier.text,
              parse_mode: 'HTML',
              reply_markup: dossier.keyboard
            };
          }
        } else if (data === 'menu:main') {
          toastText = '🏠 Main Menu';
          editPayload = {
            chat_id: chatId,
            message_id: messageId,
            text: buildMainMenuText('all'),
            parse_mode: 'HTML',
            reply_markup: getMainMenuKeyboard('all')
          };
        } else if (data === 'action:summary') {
          toastText = '📊 Compact Level 4 & 5 Summary';
          const sum = buildSummary(detailsMap);
          editPayload = {
            chat_id: chatId,
            message_id: messageId,
            text: sum.text,
            parse_mode: 'HTML',
            reply_markup: sum.keyboard
          };
        }

        await Promise.all([
          tgApi(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: toastText, show_alert: false }),
          editPayload ? tgApi(token, 'editMessageText', editPayload) : Promise.resolve()
        ]);
      }

      return new Response('OK');
    } catch (err) {
      return new Response('Error: ' + err.message, { status: 200 });
    }
  }
};
