const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/geoalerts.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS countries (
    iso2 TEXT PRIMARY KEY,
    iso3 TEXT,
    num TEXT,
    name TEXT NOT NULL,
    slug TEXT,
    region TEXT,
    lat REAL,
    lon REAL,
    overall_level INTEGER DEFAULT 1,
    max_source_level INTEGER DEFAULT 1,
    active_red_flags INTEGER DEFAULT 0,
    resonance_count INTEGER DEFAULT 0,
    last_escalation_at TEXT,
    last_updated_at TEXT,
    ai_executive_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS source_statuses (
    id TEXT PRIMARY KEY,
    iso2 TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    category TEXT NOT NULL,
    raw_level TEXT,
    normalized_level INTEGER DEFAULT 1,
    title TEXT,
    summary TEXT,
    full_text TEXT,
    content_hash TEXT,
    url TEXT,
    red_flags_json TEXT DEFAULT '[]',
    published_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    iso2 TEXT NOT NULL,
    country_name TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    category TEXT NOT NULL,
    old_level INTEGER,
    new_level INTEGER NOT NULL,
    severity_label TEXT NOT NULL,
    title TEXT NOT NULL,
    ai_summary TEXT NOT NULL,
    red_flags_json TEXT DEFAULT '[]',
    diff_before TEXT,
    diff_after TEXT,
    source_url TEXT,
    notified_telegram INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_subscribers (
    chat_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    mode TEXT DEFAULT 'all',
    selected_countries_json TEXT DEFAULT '[]',
    min_level INTEGER DEFAULT 4,
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Seed countries from data/countries.json if needed
const countriesPath = path.join(__dirname, '../data/countries.json');
if (fs.existsSync(countriesPath)) {
  const countries = JSON.parse(fs.readFileSync(countriesPath, 'utf8'));
  const upsertCountry = db.prepare(`
    INSERT INTO countries (iso2, iso3, num, name, slug, region, lat, lon, last_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(iso2) DO UPDATE SET
      iso3 = excluded.iso3,
      num = excluded.num,
      name = excluded.name,
      slug = excluded.slug,
      region = excluded.region,
      lat = excluded.lat,
      lon = excluded.lon
  `);

  const now = new Date().toISOString();
  for (const c of Object.values(countries)) {
    upsertCountry.run(c.iso2, c.iso3, c.num, c.name, c.slug, c.region, c.lat, c.lon, now);
  }
}

module.exports = { db, DB_PATH };
