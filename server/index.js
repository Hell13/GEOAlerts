const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

// Load .env if present
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

const { db } = require('./db');
const { runFullIngestion, recomputeCountryAggregates } = require('./parsers');
const { analyzeChangeWithAI } = require('./analyzer');
const { broadcastCriticalEvents, formatAlertMessage, handleTelegramUpdate, pollTelegramBotUpdates } = require('./telegram');

const PORT = Number(process.env.PORT) || 3080;
const PUBLIC_DIR = path.join(__dirname, '../public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. GET /api/overview -> All countries + stats + recent escalations
    if (req.method === 'GET' && pathname === '/api/overview') {
      const countries = db.prepare(`
        SELECT * FROM countries ORDER BY overall_level DESC, resonance_count DESC, name ASC
      `).all();

      const allSources = db.prepare(`
        SELECT iso2, source_id, source_name, category, raw_level, normalized_level, red_flags_json, updated_at
        FROM source_statuses
      `).all();

      const sourcesByIso = {};
      for (const s of allSources) {
        if (!sourcesByIso[s.iso2]) sourcesByIso[s.iso2] = [];
        sourcesByIso[s.iso2].push({
          sourceId: s.source_id,
          sourceName: s.source_name,
          category: s.category,
          rawLevel: s.raw_level,
          level: s.normalized_level,
          redFlags: JSON.parse(s.red_flags_json || '[]')
        });
      }

      const recentEvents = db.prepare(`
        SELECT * FROM change_events
        ORDER BY id DESC
        LIMIT 50
      `).all().map(e => ({
        ...e,
        redFlags: JSON.parse(e.red_flags_json || '[]')
      }));

      const lastPoll = db.prepare(`SELECT value FROM system_meta WHERE key = 'last_poll_at'`).get();

      const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const enrichedCountries = countries.map(c => {
        levelCounts[c.overall_level] = (levelCounts[c.overall_level] || 0) + 1;
        return {
          ...c,
          sources: sourcesByIso[c.iso2] || []
        };
      });

      return sendJson(res, 200, {
        lastPollAt: lastPoll?.value || new Date().toISOString(),
        openAiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here'),
        telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token_here'),
        levelCounts,
        totalCountries: enrichedCountries.length,
        countries: enrichedCountries,
        recentEvents
      });
    }

    // 2. GET /api/country/:iso2 -> Detailed breakdown by every source + diff history
    if (req.method === 'GET' && pathname.startsWith('/api/country/')) {
      const iso2 = pathname.split('/').pop().toUpperCase();
      const country = db.prepare(`SELECT * FROM countries WHERE iso2 = ?`).get(iso2);
      if (!country) return sendJson(res, 404, { error: 'Country not found' });

      const sources = db.prepare(`
        SELECT * FROM source_statuses
        WHERE iso2 = ?
        ORDER BY normalized_level DESC, source_name ASC
      `).all(iso2).map(s => ({
        ...s,
        redFlags: JSON.parse(s.red_flags_json || '[]')
      }));

      const events = db.prepare(`
        SELECT * FROM change_events
        WHERE iso2 = ?
        ORDER BY id DESC
        LIMIT 25
      `).all(iso2).map(e => ({
        ...e,
        redFlags: JSON.parse(e.red_flags_json || '[]')
      }));

      return sendJson(res, 200, {
        country,
        sources,
        events
      });
    }

    // 3. POST /api/poll -> Trigger live ingestion across all 8 sources
    if (req.method === 'POST' && pathname === '/api/poll') {
      const result = await runFullIngestion({ sendTelegramAlerts: true });
      return sendJson(res, 200, { ok: true, ...result });
    }

    // 4. POST /api/simulate-red-flag -> Simulate a realistic "Time is down to days" diplomatic wording change
    // to test the Diff engine, OpenAI gpt-4o-mini analysis, Escalation Radar pulse, and Telegram Red/Black alert!
    if (req.method === 'POST' && pathname === '/api/simulate-red-flag') {
      const body = await readJsonBody(req);
      const iso2 = (body.iso2 || 'TW').toUpperCase();
      const scenario = body.scenario || 'ordered_departure';

      const country = db.prepare(`SELECT * FROM countries WHERE iso2 = ?`).get(iso2);
      if (!country) return sendJson(res, 404, { error: 'Country not found' });

      const existingSource = db.prepare(`
        SELECT * FROM source_statuses WHERE iso2 = ? AND source_id = 'us_state_dept'
      `).get(iso2);

      const oldLevel = existingSource ? existingSource.normalized_level : country.overall_level;
      const diffBefore = existingSource
        ? existingSource.summary
        : `Exercise normal security precautions in ${country.name}. U.S. Embassy operations and consular services are operating on a normal schedule.`;

      let simTitle = '';
      let diffAfter = '';
      let simSourceId = 'us_state_dept';
      let simSourceName = 'U.S. Department of State';
      let simCategory = 'diplomatic';
      let simBaseLevel = 5;

      if (scenario === 'authorized_departure') {
        simBaseLevel = 4;
        simTitle = `${country.name} - Level 4: Authorized Departure of Non-Emergency Personnel & Family Members`;
        diffAfter = `On ${new Date().toUTCString().slice(0, 16)}, the Department of State authorized the voluntary departure (Authorized Departure) of non-emergency U.S. government employees and eligible family members from U.S. Embassy ${country.name} due to heightened security risks and potential military escalation. Commercial flights remain available but capacity may become limited with little notice.`;
      } else if (scenario === 'airspace_closure') {
        simBaseLevel = 4;
        simSourceId = 'aviation_safeairspace';
        simSourceName = 'SafeAirspace & EASA CZIB (Aviation)';
        simCategory = 'aviation';
        simTitle = `EMERGENCY NOTAM / CZIB: ${country.name} Airspace Conflict Zone Prohibition`;
        diffAfter = `FAA and EASA have issued an emergency Conflict Zone Information Bulletin (Level 1 Do Not Fly) prohibiting civil aircraft operations within ${country.name} FIR at all altitudes due to active anti-aircraft defense readiness, GPS jamming, and potential ballistic missile activity. Major European carriers have suspended night flights immediately.`;
      } else {
        // Default: Ordered Departure (Level 5 Black - Time is down to days)
        simBaseLevel = 5;
        simTitle = `${country.name} - URGENT SECURITY ALERT: Ordered Departure & Immediate Commercial Departure Advisory`;
        diffAfter = `CRITICAL UPDATE: The Department of State has ordered the departure (Ordered Departure) of family members and non-emergency U.S. government personnel from ${country.name}. U.S. citizens in ${country.name} should depart immediately via commercial or other privately available transportation options while commercial flights remain operational. The U.S. government will not be able to evacuate U.S. citizens in the event of full-scale military action.`;
      }

      const aiResult = await analyzeChangeWithAI({
        countryName: country.name,
        sourceName: simSourceName,
        oldLevel,
        newBaseLevel: simBaseLevel,
        title: simTitle,
        diffBefore,
        diffAfter,
        fullText: diffAfter
      });

      const nowIso = new Date().toISOString();

      // Update source_statuses
      db.prepare(`
        INSERT INTO source_statuses (
          id, iso2, source_id, source_name, category, raw_level, normalized_level,
          title, summary, full_text, content_hash, url, red_flags_json, published_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          raw_level = excluded.raw_level,
          normalized_level = excluded.normalized_level,
          title = excluded.title,
          summary = excluded.summary,
          full_text = excluded.full_text,
          content_hash = excluded.content_hash,
          red_flags_json = excluded.red_flags_json,
          published_at = excluded.published_at,
          updated_at = excluded.updated_at
      `).run(
        `${iso2}:${simSourceId}`,
        iso2,
        simSourceId,
        simSourceName,
        simCategory,
        simBaseLevel === 5 ? 'Level 4: Do Not Travel (Ordered Departure)' : 'Level 4: Authorized Departure / Red Flag',
        aiResult.normalizedLevel,
        simTitle,
        aiResult.aiSummary,
        diffAfter,
        'sim_' + Date.now(),
        'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html',
        JSON.stringify(aiResult.redFlags),
        nowIso,
        nowIso
      );

      const eventObj = {
        iso2,
        countryName: country.name,
        sourceId: simSourceId,
        sourceName: simSourceName,
        category: simCategory,
        oldLevel,
        newLevel: aiResult.normalizedLevel,
        severityLabel: aiResult.severityLabel,
        title: simTitle,
        aiSummary: aiResult.aiSummary,
        redFlags: aiResult.redFlags,
        diffBefore,
        diffAfter,
        sourceUrl: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html',
        createdAt: nowIso
      };

      db.prepare(`
        INSERT INTO change_events (
          iso2, country_name, source_id, source_name, category,
          old_level, new_level, severity_label, title, ai_summary,
          red_flags_json, diff_before, diff_after, source_url, notified_telegram, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        eventObj.iso2,
        eventObj.countryName,
        eventObj.sourceId,
        eventObj.sourceName,
        eventObj.category,
        eventObj.oldLevel,
        eventObj.newLevel,
        eventObj.severityLabel,
        eventObj.title,
        eventObj.aiSummary,
        JSON.stringify(eventObj.redFlags),
        eventObj.diffBefore,
        eventObj.diffAfter,
        eventObj.sourceUrl,
        eventObj.createdAt
      );

      recomputeCountryAggregates();
      const tgDispatch = await broadcastCriticalEvents([eventObj]);
      const previewTelegramHtml = formatAlertMessage(eventObj);

      return sendJson(res, 200, {
        ok: true,
        event: eventObj,
        usedOpenAI: aiResult.usedOpenAI,
        telegramDispatch: tgDispatch,
        previewTelegramHtml
      });
    }

    // 5. GET & POST /api/telegram/settings -> Manage Telegram subscribers & test message
    if (req.method === 'GET' && pathname === '/api/telegram/settings') {
      const subscribers = db.prepare(`SELECT * FROM telegram_subscribers ORDER BY updated_at DESC`).all().map(s => ({
        ...s,
        selectedCountries: JSON.parse(s.selected_countries_json || '[]')
      }));
      return sendJson(res, 200, {
        botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token_here'),
        subscribers
      });
    }

    if (req.method === 'POST' && pathname === '/api/telegram/settings') {
      const body = await readJsonBody(req);
      const chatId = String(body.chatId || 'default_admin').trim();
      const mode = body.mode === 'selected' ? 'selected' : 'all';
      const selectedCountries = Array.isArray(body.selectedCountries) ? body.selectedCountries : [];
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO telegram_subscribers (chat_id, username, first_name, mode, selected_countries_json, min_level, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 4, 1, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          mode = excluded.mode,
          selected_countries_json = excluded.selected_countries_json,
          updated_at = excluded.updated_at
      `).run(chatId, body.username || 'admin', body.firstName || 'Admin', mode, JSON.stringify(selectedCountries), now, now);

      return sendJson(res, 200, { ok: true, chatId, mode, selectedCountries });
    }

    // 6. POST /api/telegram/webhook -> Webhook receiver for Telegram Bot
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const update = await readJsonBody(req);
      await handleTelegramUpdate(update);
      return sendJson(res, 200, { ok: true });
    }

    // 7. Static files serving
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const resolvedPath = path.normalize(path.join(PUBLIC_DIR, filePath));
    if (!resolvedPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const ext = path.extname(resolvedPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(resolvedPath).pipe(res);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error('[Server Error]', err);
    sendJson(res, 500, { error: err.message });
  }
});

// Initial database bootstrap if source_statuses is empty
(async () => {
  const count = db.prepare(`SELECT COUNT(*) as c FROM source_statuses`).get().c;
  if (count === 0) {
    console.log('[GEOAlerts] Bootstrapping global intelligence database from 8 official sources...');
    const res = await runFullIngestion({ sendTelegramAlerts: false });
    console.log(`[GEOAlerts] Initial ingestion complete in ${res.durationMs}ms (${res.totalRecordsScanned} records processed).`);
  }

  // Ensure default admin subscriber row exists for UI preview
  const subCount = db.prepare(`SELECT COUNT(*) as c FROM telegram_subscribers`).get().c;
  if (subCount === 0) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO telegram_subscribers (chat_id, username, first_name, mode, selected_countries_json, min_level, active, created_at, updated_at)
      VALUES ('admin_profile', 'owner', 'Primary Watchlist', 'all', '["UA","IL","LB","IR","TW","RS","PL","MD","KP","KR"]', 4, 1, ?, ?)
    `).run(now, now);
  }

  server.listen(PORT, () => {
    console.log(`[GEOAlerts] Geopolitical Early Warning Platform running at http://localhost:${PORT}`);
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token_here') {
      console.log('[GEOAlerts] Starting real-time Telegram Bot interactive listener (@GeoAlerts13Bot)...');
      let tgBusy = false;
      setInterval(async () => {
        if (tgBusy) return;
        tgBusy = true;
        try {
          await pollTelegramBotUpdates();
        } catch (_) {
        } finally {
          tgBusy = false;
        }
      }, 1500);
    }
  });
})();
