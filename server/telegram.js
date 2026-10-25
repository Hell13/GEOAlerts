const { db } = require('./db');
const fs = require('fs');
const path = require('path');

const countriesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/countries.json'), 'utf8'));

// Build multi-language lookup (English, Russian via Intl.DisplayNames, ISO2, ISO3)
const ruNames = new Intl.DisplayNames(['ru'], { type: 'region' });
const enNames = new Intl.DisplayNames(['en'], { type: 'region' });

const COUNTRY_SEARCH_INDEX = [];
for (const [iso2, c] of Object.entries(countriesData)) {
  let ruName = '';
  let enIntl = '';
  try { ruName = (ruNames.of(iso2) || '').toLowerCase(); } catch (_) {}
  try { enIntl = (enNames.of(iso2) || '').toLowerCase(); } catch (_) {}
  COUNTRY_SEARCH_INDEX.push({
    iso2,
    iso3: (c.iso3 || '').toLowerCase(),
    name: c.name,
    nameLower: c.name.toLowerCase(),
    ruName,
    enIntl
  });
}

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

function findCountryByQuery(rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return null;

  if (CUSTOM_ALIASES[q] && countriesData[CUSTOM_ALIASES[q]]) {
    return countriesData[CUSTOM_ALIASES[q]];
  }

  // Exact ISO2 or ISO3 match
  if (q.length === 2 && countriesData[q.toUpperCase()]) {
    return countriesData[q.toUpperCase()];
  }
  const exactIso3 = COUNTRY_SEARCH_INDEX.find(item => item.iso3 === q);
  if (exactIso3) return countriesData[exactIso3.iso2];

  // Exact name match
  const exactName = COUNTRY_SEARCH_INDEX.find(
    item => item.nameLower === q || item.ruName === q || item.enIntl === q
  );
  if (exactName) return countriesData[exactName.iso2];

  // Prefix / Substring match (min 3 chars)
  if (q.length >= 3) {
    const partial = COUNTRY_SEARCH_INDEX.find(
      item => item.nameLower.includes(q) || item.ruName.includes(q) || item.enIntl.includes(q)
    );
    if (partial) return countriesData[partial.iso2];
  }

  return null;
}

const REGIONS = {
  'Middle East': ['IL', 'PS', 'LB', 'IR', 'IQ', 'SY', 'YE', 'JO', 'EG', 'SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'TR'],
  'Europe & East': ['UA', 'RU', 'BY', 'MD', 'PL', 'LT', 'LV', 'EE', 'FI', 'RS', 'XK', 'BA', 'GE', 'AM', 'AZ', 'DE', 'FR', 'GB', 'CY'],
  'Asia-Pacific': ['TW', 'CN', 'KP', 'KR', 'JP', 'PH', 'MM', 'AF', 'PK', 'IN', 'BD', 'TH', 'VN', 'ID', 'SG'],
  'Africa': ['SD', 'SS', 'ET', 'SO', 'CD', 'ML', 'NE', 'BF', 'LY', 'TD', 'CF', 'NG', 'MZ', 'KE', 'ZA'],
  'Americas': ['VE', 'HT', 'CU', 'MX', 'CO', 'EC', 'NI', 'HN', 'US', 'CA', 'BR', 'AR']
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

function formatAlertMessage(event) {
  const isLevel5 = Number(event.newLevel) >= 5;
  const headerBadge = isLevel5
    ? '⚫️🚨 <b>CRITICAL WAR / EVACUATION WARNING (LEVEL 5)</b> 🚨⚫️'
    : '🔴⚠️ <b>RED FLAG ESCALATION ALERT (LEVEL 4)</b> ⚠️🔴';

  const flags = Array.isArray(event.redFlags) ? event.redFlags : [];
  const flagsHtml = flags.length > 0
    ? `\n<b>🚩 Red Flags Detected:</b>\n${flags.map(f => `  • <code>${escapeHtml(f)}</code>`).join('\n')}\n`
    : '';

  const diffHtml = (event.diffBefore || event.diffAfter)
    ? `\n<b>🔍 Wording Diff (What Changed):</b>\n` +
      (event.diffBefore ? `➖ <i>Before:</i> ${escapeHtml(event.diffBefore.slice(0, 220))}\n` : '') +
      (event.diffAfter ? `➕ <i>After:</i> <b>${escapeHtml(event.diffAfter.slice(0, 320))}</b>\n` : '')
    : '';

  return (
    `${headerBadge}\n\n` +
    `🌍 <b>Country:</b> ${escapeHtml(event.countryName)} (${event.iso2})\n` +
    `🏛 <b>Source:</b> ${escapeHtml(event.sourceName)}\n` +
    `📈 <b>Threat Escalation:</b> Level ${event.oldLevel || 1} ➔ <b>Level ${event.newLevel} (${escapeHtml(event.severityLabel)})</b>\n` +
    `📌 <b>Headline:</b> ${escapeHtml(event.title)}\n` +
    `${flagsHtml}\n` +
    `🧠 <b>AI Crisis Intelligence Brief:</b>\n${escapeHtml(event.aiSummary)}\n` +
    `${diffHtml}\n` +
    `🔗 <a href="${event.sourceUrl || 'https://travel.state.gov'}">View Official Source Document</a>`
  );
}

function formatCountryDossierMessage(iso2, sub) {
  const country = db.prepare(`SELECT * FROM countries WHERE iso2 = ?`).get(iso2);
  if (!country) return null;

  const sources = db.prepare(`
    SELECT * FROM source_statuses
    WHERE iso2 = ?
    ORDER BY normalized_level DESC, source_name ASC
  `).all(iso2);

  const lvl = country.overall_level || 1;
  const lvlIcon = lvl === 5 ? '⚫️' : lvl === 4 ? '🔴' : lvl === 3 ? '🟠' : lvl === 2 ? '🟡' : '🟢';

  const allFlags = new Set();
  for (const s of sources) {
    try {
      const parsed = JSON.parse(s.red_flags_json || '[]');
      parsed.forEach(f => allFlags.add(f));
    } catch (_) {}
  }

  const sourceLines = sources.map(s => {
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

  const selected = new Set(JSON.parse(sub?.selected_countries_json || '[]'));
  const isWatched = selected.has(iso2);

  const text =
    `🌎 <b>COUNTRY INTELLIGENCE DOSSIER: ${escapeHtml(country.name.toUpperCase())} (${iso2})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<b>Composite Status:</b> ${LEVEL_BADGES[lvl] || `${lvlIcon} LEVEL ${lvl}`}\n` +
    `<b>Multi-Agency Resonance:</b> ${country.resonance_count > 0 ? `⚠️ <b>${country.resonance_count} agencies at Level 4+</b>` : `${sources.length} official sources monitored`}\n` +
    `<b>Watchlist Status:</b> ${isWatched ? '⭐ In your Selected Watchlist' : '⬜️ Not in Selected Watchlist'}\n` +
    `${flagsBlock}\n` +
    `🧠 <b>Executive Summary:</b>\n${escapeHtml(country.ai_executive_summary || 'Standard monitoring active.')}\n\n` +
    `🏛 <b>Status by Each Official Source (${sources.length}):</b>\n\n` +
    (sourceLines.length > 0 ? sourceLines.join('\n\n') : '<i>No active advisories recorded.</i>');

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: isWatched ? `✅ Watched in Selected (${iso2}) — Remove` : `⭐ Add ${country.name} (${iso2}) to Watchlist`,
          callback_data: `watch_dossier:${iso2}`
        }
      ],
      [
        { text: '🔍 Check Another Country', callback_data: 'action:lookup_menu' },
        { text: '⬅️ Main Menu', callback_data: 'menu:main' }
      ]
    ]
  };

  return { text, keyboard };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function callTelegramApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Sends ONLY Level 4 (Red) and Level 5 (Black) events to subscribed users
 * respecting their mode ('all' vs 'selected' countries).
 */
async function broadcastCriticalEvents(events) {
  const criticalOnly = (events || []).filter(e => Number(e.newLevel) >= 4);
  if (criticalOnly.length === 0) return { sent: 0 };

  const subscribers = db.prepare(`SELECT * FROM telegram_subscribers WHERE active = 1`).all();
  let sentCount = 0;

  for (const event of criticalOnly) {
    const htmlMessage = formatAlertMessage(event);

    for (const sub of subscribers) {
      if (sub.chat_id === 'admin_profile') continue;
      if (sub.mode === 'selected') {
        let selected = [];
        try { selected = JSON.parse(sub.selected_countries_json || '[]'); } catch (_) {}
        if (!selected.includes(event.iso2)) continue;
      }

      const resp = await callTelegramApi('sendMessage', {
        chat_id: sub.chat_id,
        text: htmlMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });
      if (resp.ok) sentCount++;
    }
  }

  return { sent: sentCount, eventsCount: criticalOnly.length };
}

function buildMainMenuText(sub) {
  const modeAll = sub.mode === 'all';
  let selected = [];
  try { selected = JSON.parse(sub.selected_countries_json || '[]'); } catch (_) {}
  const selectedNames = selected.map(code => `${countriesData[code]?.name || code} (${code})`).join(', ');

  return (
    `🛡 <b>GEOAlerts — Early Warning Control Center</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📡 <b>Alert Mode:</b> ${modeAll ? '✅ <b>🌍 All Countries Worldwide (Default)</b>' : `✅ <b>⭐ Selected Countries Only (${selected.length})</b>`}\n` +
    `⭐ <b>Your Watchlist (${selected.length}):</b> <code>${selectedNames || 'None'}</code>\n` +
    `🔇 <b>Noise Filter:</b> Levels 1–3 are silenced. Only <b>🔴 Level 4</b> & <b>⚫️ Level 5</b> trigger pushes.\n\n` +
    `💡 <i>Tip: You can also type any country name in chat (e.g. <code>Israel</code>, <code>Израиль</code>, <code>Taiwan</code>, <code>UA</code>) to instantly inspect its dossier!</i>`
  );
}

function getMainMenuKeyboard(sub) {
  const modeAll = sub.mode === 'all';
  let selected = [];
  try { selected = JSON.parse(sub.selected_countries_json || '[]'); } catch (_) {}

  const buttons = [
    [
      {
        text: `${modeAll ? '✅ ' : ''}🌍 All Countries (Default)`,
        callback_data: 'mode:all'
      },
      {
        text: `${!modeAll ? '✅ ' : ''}⭐ Selected Only (${selected.length})`,
        callback_data: 'mode:selected'
      }
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
    ]
  ];
  return { inline_keyboard: buttons };
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

function getLookupRegionCountriesKeyboard(regionName) {
  const isoList = REGIONS[regionName] || [];
  const rows = [];
  let currentRow = [];

  for (const iso2 of isoList) {
    const cRow = db.prepare(`SELECT name, overall_level FROM countries WHERE iso2 = ?`).get(iso2);
    const name = cRow?.name || countriesData[iso2]?.name || iso2;
    const lvl = cRow?.overall_level || 1;
    const dot = lvl === 5 ? '⚫️' : lvl === 4 ? '🔴' : lvl === 3 ? '🟠' : lvl === 2 ? '🟡' : '🟢';

    currentRow.push({
      text: `${dot} ${name} (L${lvl})`,
      callback_data: `dossier:${iso2}`
    });
    if (currentRow.length === 2) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  rows.push([
    { text: '⬅️ Back to Regions', callback_data: 'action:lookup_menu' },
    { text: '🏠 Main Menu', callback_data: 'menu:main' }
  ]);
  return { inline_keyboard: rows };
}

function getRegionCountriesKeyboard(regionName, sub) {
  const isoList = REGIONS[regionName] || [];
  const selected = new Set(JSON.parse(sub.selected_countries_json || '[]'));
  const rows = [];
  let currentRow = [];

  for (const iso2 of isoList) {
    const name = countriesData[iso2]?.name || iso2;
    const isChecked = selected.has(iso2);
    currentRow.push({
      text: `${isChecked ? '✅' : '⬜️'} ${name}`,
      callback_data: `toggle:${iso2}:${regionName}`
    });
    if (currentRow.length === 2) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  rows.push([{ text: '⬅️ Done / Back to Main Menu', callback_data: 'menu:main' }]);
  return { inline_keyboard: rows };
}

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

function buildSummaryMessage() {
  const l5List = db.prepare(`
    SELECT iso2, name, resonance_count FROM countries
    WHERE overall_level = 5 ORDER BY resonance_count DESC, name ASC
  `).all();
  const l4List = db.prepare(`
    SELECT iso2, name, resonance_count FROM countries
    WHERE overall_level = 4 ORDER BY resonance_count DESC, name ASC LIMIT 12
  `).all();
  const totalL4 = db.prepare(`SELECT COUNT(*) as c FROM countries WHERE overall_level = 4`).get().c;

  const l5Str = l5List.map(c => `• <b>${escapeHtml(c.name)}</b> (<code>${c.iso2}</code>) — ${c.resonance_count} src`).join('\n');
  const l4Str = l4List.map(c => `• <b>${escapeHtml(c.name)}</b> (<code>${c.iso2}</code>)`).join('\n');

  return {
    text:
      `📊 <b>Compact Level 4 & 5 Flashpoints</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚫️ <b>Level 5 Critical (${l5List.length}):</b>\n${l5Str || 'None'}\n\n` +
      `🔴 <b>Top Level 4 Red Flag (showing 12 of ${totalL4}):</b>\n${l4Str || 'None'}\n\n` +
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

async function registerBotMenuCommands() {
  await callTelegramApi('setMyCommands', {
    commands: [
      { command: 'menu', description: '🛡 Открыть главное меню и настройки (Control Center)' },
      { command: 'status', description: '🔍 Узнать статус страны (Check Country Status)' },
      { command: 'summary', description: '📊 Сводка горячих точек L4 & L5 (Flashpoints Summary)' }
    ]
  });
  await callTelegramApi('setChatMenuButton', {
    menu_button: { type: 'commands' }
  });
}

async function handleTelegramUpdate(update) {
  const now = new Date().toISOString();

  if (update.message) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();
    const textLower = text.toLowerCase();
    if (!text) return;

    db.prepare(`
      INSERT INTO telegram_subscribers (chat_id, username, first_name, mode, selected_countries_json, min_level, active, created_at, updated_at)
      VALUES (?, ?, ?, 'all', '["UA","IL","LB","IR","TW"]', 4, 1, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        active = 1,
        updated_at = excluded.updated_at
    `).run(chatId, msg.from?.username || '', msg.from?.first_name || 'User', now, now);

    const sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);

    if (
      text.startsWith('/start') ||
      text.startsWith('/settings') ||
      text.startsWith('/menu') ||
      text === '🛡 Меню настроек' ||
      textLower === 'меню' ||
      textLower === 'menu'
    ) {
      // Pin persistent bottom bar if /start
      if (text.startsWith('/start')) {
        await callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⌨️ <b>Нижняя панель быстрого вызова меню закреплена!</b> Используйте кнопки внизу экрана в любой момент:',
          parse_mode: 'HTML',
          reply_markup: PERSISTENT_BOTTOM_KEYBOARD
        });
      }
      await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: buildMainMenuText(sub),
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      });
      return;
    }

    if (
      text === '/status' ||
      text === '🔍 Узнать статус страны' ||
      textLower === 'статус' ||
      textLower === 'узнать статус страны'
    ) {
      await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `🔍 <b>Check Country Intelligence Status</b>\n\n` +
          `1️⃣ <b>By Text:</b> Simply type and send any country name or ISO code right into this chat (in Russian or English, e.g. <code>Израиль</code>, <code>Taiwan</code>, <code>Таиланд</code>, <code>UA</code>).\n\n` +
          `2️⃣ <b>From List:</b> Or choose a region below to pick a country with one tap:`,
        parse_mode: 'HTML',
        reply_markup: getLookupMenuKeyboard()
      });
      return;
    }

    if (
      text.startsWith('/summary') ||
      text === '📊 Сводка L4 & L5' ||
      textLower === 'сводка'
    ) {
      const sum = buildSummaryMessage();
      await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: sum.text,
        parse_mode: 'HTML',
        reply_markup: sum.keyboard
      });
      return;
    }

    if (text.startsWith('/watch')) {
      const codes = text.replace('/watch', '').trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
      const valid = codes.filter(c => countriesData[c]);
      if (valid.length > 0) {
        db.prepare(`UPDATE telegram_subscribers SET mode = 'selected', selected_countries_json = ?, updated_at = ? WHERE chat_id = ?`)
          .run(JSON.stringify(valid), now, chatId);
        const updatedSub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);
        await callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `✅ Switched to <b>⭐ Selected Countries Only</b>: ${valid.map(c => `${countriesData[c].name} (${c})`).join(', ')}`,
          parse_mode: 'HTML',
          reply_markup: getMainMenuKeyboard(updatedSub)
        });
      }
      return;
    }

    // Otherwise treat text message (or /status <country>) as a Country Status Lookup!
    const queryStr = text.replace(/^\/(status|check|country)\s*/i, '').trim();
    const matchedCountry = findCountryByQuery(queryStr);

    if (matchedCountry) {
      const dossier = formatCountryDossierMessage(matchedCountry.iso2, sub);
      if (dossier) {
        await callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: dossier.text,
          parse_mode: 'HTML',
          reply_markup: dossier.keyboard
        });
        return;
      }
    }

    await callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `❓ Country <b>"${escapeHtml(queryStr)}"</b> not found.\n\nType any country name in English or Russian (e.g. <code>Israel</code>, <code>Израиль</code>, <code>Taiwan</code>, <code>Thailand</code>) or select from a region below:`,
      parse_mode: 'HTML',
      reply_markup: getLookupMenuKeyboard()
    });
  } else if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.message.chat.id);
    const messageId = cb.message.message_id;
    const data = cb.data || '';

    let sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);
    if (!sub) {
      db.prepare(`
        INSERT INTO telegram_subscribers (chat_id, username, first_name, mode, selected_countries_json, min_level, active, created_at, updated_at)
        VALUES (?, ?, ?, 'all', '["UA","IL","LB","IR","TW"]', 4, 1, ?, ?)
      `).run(chatId, cb.from?.username || '', cb.from?.first_name || 'User', now, now);
      sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);
    }

    let toastText = '✅ Updated';
    let editPayload = null;

    if (data === 'mode:all' || data === 'mode:selected') {
      const newMode = data.split(':')[1];
      db.prepare(`UPDATE telegram_subscribers SET mode = ?, updated_at = ? WHERE chat_id = ?`).run(newMode, now, chatId);
      sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);

      toastText = newMode === 'all'
        ? '🌍 Mode: All Countries Worldwide active!'
        : '⭐ Mode: Selected Countries Only active!';

      editPayload = {
        chat_id: chatId,
        message_id: messageId,
        text: buildMainMenuText(sub),
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      };
    } else if (data.startsWith('region:')) {
      const regionName = data.slice(7);
      const selected = JSON.parse(sub.selected_countries_json || '[]');
      toastText = `⚙️ Editing Watchlist: ${regionName}`;
      editPayload = {
        chat_id: chatId,
        message_id: messageId,
        text:
          `⚙️ <b>Edit Watchlist — ${escapeHtml(regionName)}</b>\n` +
          `Tap countries below to add/remove them from your <b>⭐ Selected Only</b> alert list (currently ${selected.length} watched):`,
        parse_mode: 'HTML',
        reply_markup: getRegionCountriesKeyboard(regionName, sub)
      };
    } else if (data.startsWith('toggle:')) {
      const [, iso2, regionName] = data.split(':');
      const selected = new Set(JSON.parse(sub.selected_countries_json || '[]'));
      const cName = countriesData[iso2]?.name || iso2;
      if (selected.has(iso2)) {
        selected.delete(iso2);
        toastText = `➖ Removed ${cName} (${iso2}) from Watchlist`;
      } else {
        selected.add(iso2);
        toastText = `✅ Added ${cName} (${iso2}) to Watchlist`;
      }

      db.prepare(`UPDATE telegram_subscribers SET mode = 'selected', selected_countries_json = ?, updated_at = ? WHERE chat_id = ?`)
        .run(JSON.stringify([...selected]), now, chatId);
      sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);

      editPayload = {
        chat_id: chatId,
        message_id: messageId,
        text:
          `⚙️ <b>Edit Watchlist — ${escapeHtml(regionName)}</b>\n` +
          `Last action: <b>${escapeHtml(toastText)}</b>\n` +
          `Active Watchlist (${selected.size}): <code>${[...selected].join(', ') || 'None'}</code>`,
        parse_mode: 'HTML',
        reply_markup: getRegionCountriesKeyboard(regionName, sub)
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
    } else if (data.startsWith('lookup_reg:')) {
      const regionName = data.slice(11);
      toastText = `📍 ${regionName}`;
      editPayload = {
        chat_id: chatId,
        message_id: messageId,
        text: `📍 <b>${escapeHtml(regionName)} — Select a Country to View Full Dossier:</b>`,
        parse_mode: 'HTML',
        reply_markup: getLookupRegionCountriesKeyboard(regionName)
      };
    } else if (data.startsWith('dossier:')) {
      const iso2 = data.slice(8);
      const dossier = formatCountryDossierMessage(iso2, sub);
      toastText = `🌎 Loaded dossier for ${countriesData[iso2]?.name || iso2}`;
      if (dossier) {
        editPayload = {
          chat_id: chatId,
          message_id: messageId,
          text: dossier.text,
          parse_mode: 'HTML',
          reply_markup: dossier.keyboard
        };
      }
    } else if (data.startsWith('watch_dossier:')) {
      const iso2 = data.slice(14);
      const selected = new Set(JSON.parse(sub.selected_countries_json || '[]'));
      const cName = countriesData[iso2]?.name || iso2;
      if (selected.has(iso2)) {
        selected.delete(iso2);
        toastText = `➖ Removed ${cName} from Watchlist`;
      } else {
        selected.add(iso2);
        toastText = `⭐ Added ${cName} to Watchlist`;
      }
      db.prepare(`UPDATE telegram_subscribers SET selected_countries_json = ?, updated_at = ? WHERE chat_id = ?`)
        .run(JSON.stringify([...selected]), now, chatId);
      sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);

      const dossier = formatCountryDossierMessage(iso2, sub);
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
        text: buildMainMenuText(sub),
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      };
    } else if (data === 'action:summary') {
      toastText = '📊 Compact Level 4 & 5 Summary';
      const sum = buildSummaryMessage();
      editPayload = {
        chat_id: chatId,
        message_id: messageId,
        text: sum.text,
        parse_mode: 'HTML',
        reply_markup: sum.keyboard
      };
    }

    // Fire toast acknowledgement and message edit simultaneously for sub-100ms response!
    await Promise.all([
      callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: toastText,
        show_alert: false
      }),
      editPayload ? callTelegramApi('editMessageText', editPayload) : Promise.resolve()
    ]);
  }
}

let cachedTgOffset = null;

async function pollTelegramBotUpdates(timeoutSec = 2) {
  if (cachedTgOffset === null) {
    const offsetRow = db.prepare(`SELECT value FROM system_meta WHERE key = 'tg_update_offset'`).get();
    cachedTgOffset = offsetRow ? Number(offsetRow.value) : 0;
  }

  const res = await callTelegramApi('getUpdates', {
    offset: cachedTgOffset,
    timeout: timeoutSec,
    allowed_updates: ['message', 'callback_query']
  });

  if (!res.ok || !Array.isArray(res.result) || res.result.length === 0) return 0;

  let maxUpdateId = cachedTgOffset;
  for (const update of res.result) {
    if (update.update_id >= maxUpdateId) {
      maxUpdateId = update.update_id + 1;
    }
  }

  if (maxUpdateId > cachedTgOffset) {
    cachedTgOffset = maxUpdateId;
    db.prepare(`
      INSERT INTO system_meta (key, value) VALUES ('tg_update_offset', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(maxUpdateId));
  }

  await Promise.all(res.result.map(update => handleTelegramUpdate(update)));
  return res.result.length;
}

module.exports = {
  formatAlertMessage,
  formatCountryDossierMessage,
  broadcastCriticalEvents,
  handleTelegramUpdate,
  pollTelegramBotUpdates,
  registerBotMenuCommands,
  PERSISTENT_BOTTOM_KEYBOARD,
  buildMainMenuText,
  getMainMenuKeyboard,
  callTelegramApi
};
