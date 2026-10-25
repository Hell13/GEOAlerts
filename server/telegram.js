const { db } = require('./db');
const fs = require('fs');
const path = require('path');

const countriesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/countries.json'), 'utf8'));

const REGIONS = {
  'Middle East': ['IL', 'PS', 'LB', 'IR', 'IQ', 'SY', 'YE', 'JO', 'EG', 'SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'TR'],
  'Europe & East': ['UA', 'RU', 'BY', 'MD', 'PL', 'LT', 'LV', 'EE', 'FI', 'RS', 'XK', 'BA', 'GE', 'AM', 'AZ'],
  'Asia-Pacific': ['TW', 'CN', 'KP', 'KR', 'JP', 'PH', 'MM', 'AF', 'PK', 'IN', 'BD', 'TH'],
  'Africa': ['SD', 'SS', 'ET', 'SO', 'CD', 'ML', 'NE', 'BF', 'LY', 'TD', 'CF', 'NG', 'MZ'],
  'Americas': ['VE', 'HT', 'CU', 'MX', 'CO', 'EC', 'NI', 'HN']
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

function getMainMenuKeyboard(sub) {
  const modeAll = sub.mode === 'all';
  const selected = JSON.parse(sub.selected_countries_json || '[]');

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
      { text: '🔥 Middle East', callback_data: 'region:Middle East' },
      { text: '🛡 Europe & East', callback_data: 'region:Europe & East' }
    ],
    [
      { text: '🌏 Asia-Pacific', callback_data: 'region:Asia-Pacific' },
      { text: '🌍 Africa', callback_data: 'region:Africa' },
      { text: '🌎 Americas', callback_data: 'region:Americas' }
    ],
    [
      { text: '📊 Current Level 4 & 5 Summary', callback_data: 'action:summary' }
    ]
  ];
  return { inline_keyboard: buttons };
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

  rows.push([{ text: '⬅️ Back to Main Settings', callback_data: 'menu:main' }]);
  return { inline_keyboard: rows };
}

async function handleTelegramUpdate(update) {
  const now = new Date().toISOString();

  if (update.message) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();

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

    if (text.startsWith('/start') || text.startsWith('/settings')) {
      const selected = JSON.parse(sub.selected_countries_json || '[]');
      const welcome =
        `🛡 <b>GEOAlerts — Geopolitical Early Warning Bot</b>\n\n` +
        `Noise filter is strictly active: you will <b>ONLY</b> receive alerts for:\n` +
        `• 🔴 <b>Level 4 (Red Flag):</b> Authorized Departure of diplomatic families, Shelter-in-Place orders, Conflict Zone Airspace NOTAMs.\n` +
        `• ⚫️ <b>Level 5 (Critical / Imminent War):</b> Mandatory diplomat evacuation (Ordered Departure), "Leave Immediately" warnings, multi-country resonance.\n` +
        `<i>(Green & Yellow routine updates are silenced and logged on the web map only.)</i>\n\n` +
        `<b>Your Current Mode:</b> ${sub.mode === 'all' ? '🌍 All Countries Worldwide' : `⭐ Selected Countries (${selected.join(', ') || 'None'})`}\n\n` +
        `Choose your notification scope below or type <code>/watch UA IL TW</code> to quickly toggle country ISO codes:`;

      await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: welcome,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      });
    } else if (text.startsWith('/watch')) {
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
    }
  } else if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.message.chat.id);
    const messageId = cb.message.message_id;
    const data = cb.data || '';

    let sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);
    if (!sub) return;

    if (data === 'mode:all' || data === 'mode:selected') {
      const newMode = data.split(':')[1];
      db.prepare(`UPDATE telegram_subscribers SET mode = ?, updated_at = ? WHERE chat_id = ?`).run(newMode, now, chatId);
      sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);
      const selected = JSON.parse(sub.selected_countries_json || '[]');

      await callTelegramApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text:
          `🛡 <b>GEOAlerts Notification Settings</b>\n\n` +
          `<b>Active Mode:</b> ${sub.mode === 'all' ? '🌍 All Countries Worldwide (Red & Black Flags)' : `⭐ Selected Countries Only (${selected.join(', ') || 'None'})`}\n\n` +
          `Select a region below to customize your watched countries:`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      });
    } else if (data.startsWith('region:')) {
      const regionName = data.slice(7);
      await callTelegramApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `📍 <b>Select Countries in ${regionName}:</b>\nTap any country to toggle 🔴 Red / ⚫️ Black Flag notifications:`,
        parse_mode: 'HTML',
        reply_markup: getRegionCountriesKeyboard(regionName, sub)
      });
    } else if (data.startsWith('toggle:')) {
      const [, iso2, regionName] = data.split(':');
      const selected = new Set(JSON.parse(sub.selected_countries_json || '[]'));
      if (selected.has(iso2)) selected.delete(iso2);
      else selected.add(iso2);

      db.prepare(`UPDATE telegram_subscribers SET mode = 'selected', selected_countries_json = ?, updated_at = ? WHERE chat_id = ?`)
        .run(JSON.stringify([...selected]), now, chatId);
      sub = db.prepare(`SELECT * FROM telegram_subscribers WHERE chat_id = ?`).get(chatId);

      await callTelegramApi('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: getRegionCountriesKeyboard(regionName, sub)
      });
    } else if (data === 'menu:main') {
      const selected = JSON.parse(sub.selected_countries_json || '[]');
      await callTelegramApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text:
          `🛡 <b>GEOAlerts Notification Settings</b>\n\n` +
          `<b>Active Mode:</b> ${sub.mode === 'all' ? '🌍 All Countries Worldwide' : `⭐ Selected Countries (${selected.join(', ') || 'None'})`}`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(sub)
      });
    } else if (data === 'action:summary') {
      const topCountries = db.prepare(`
        SELECT iso2, name, overall_level, resonance_count
        FROM countries
        WHERE overall_level >= 4
        ORDER BY overall_level DESC, resonance_count DESC
        LIMIT 15
      `).all();

      const lines = topCountries.map(c =>
        `${c.overall_level === 5 ? '⚫️ L5' : '🔴 L4'} <b>${c.name}</b> (${c.iso2}) — ${c.resonance_count} active sources`
      );

      await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `📊 <b>Current Global Level 4 & 5 Flashpoints:</b>\n\n${lines.join('\n')}`,
        parse_mode: 'HTML'
      });
    }

    await callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id });
  }
}

module.exports = {
  formatAlertMessage,
  broadcastCriticalEvents,
  handleTelegramUpdate,
  callTelegramApi
};
