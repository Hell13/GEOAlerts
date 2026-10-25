/**
 * Exports static JSON snapshots into public/data/ so the frontend map
 * works 100% serverless on Cloudflare Pages / Vercel / GitHub Pages
 * while also working with the local Node server.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');

function exportStaticData() {
  const outDir = path.join(__dirname, '../public/data');
  fs.mkdirSync(outDir, { recursive: true });

  const countries = db.prepare(`
    SELECT * FROM countries ORDER BY overall_level DESC, resonance_count DESC, name ASC
  `).all();

  const allSources = db.prepare(`
    SELECT * FROM source_statuses ORDER BY normalized_level DESC, source_name ASC
  `).all().map(s => ({
    ...s,
    redFlags: JSON.parse(s.red_flags_json || '[]')
  }));

  const sourcesByIso = {};
  const fullSourcesByIso = {};
  for (const s of allSources) {
    if (!sourcesByIso[s.iso2]) sourcesByIso[s.iso2] = [];
    if (!fullSourcesByIso[s.iso2]) fullSourcesByIso[s.iso2] = [];

    sourcesByIso[s.iso2].push({
      sourceId: s.source_id,
      sourceName: s.source_name,
      category: s.category,
      rawLevel: s.raw_level,
      level: s.normalized_level,
      redFlags: s.redFlags
    });
    fullSourcesByIso[s.iso2].push(s);
  }

  const recentEvents = db.prepare(`
    SELECT * FROM change_events ORDER BY id DESC LIMIT 100
  `).all().map(e => ({
    ...e,
    redFlags: JSON.parse(e.red_flags_json || '[]')
  }));

  const eventsByIso = {};
  for (const e of recentEvents) {
    if (!eventsByIso[e.iso2]) eventsByIso[e.iso2] = [];
    eventsByIso[e.iso2].push(e);
  }

  const lastPoll = db.prepare(`SELECT value FROM system_meta WHERE key = 'last_poll_at'`).get();
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const enrichedCountries = countries.map(c => {
    levelCounts[c.overall_level] = (levelCounts[c.overall_level] || 0) + 1;
    return {
      ...c,
      sources: sourcesByIso[c.iso2] || []
    };
  });

  const overviewPayload = {
    lastPollAt: lastPoll?.value || new Date().toISOString(),
    openAiConfigured: true,
    telegramConfigured: true,
    levelCounts,
    totalCountries: enrichedCountries.length,
    countries: enrichedCountries,
    recentEvents: recentEvents.slice(0, 50)
  };

  const detailsByIso = {};
  for (const c of countries) {
    detailsByIso[c.iso2] = {
      country: c,
      sources: fullSourcesByIso[c.iso2] || [],
      events: eventsByIso[c.iso2] || []
    };
  }

  fs.writeFileSync(path.join(outDir, 'overview.json'), JSON.stringify(overviewPayload));
  fs.writeFileSync(path.join(outDir, 'countries_details.json'), JSON.stringify(detailsByIso));
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}
}

module.exports = { exportStaticData };
