-- Supabase PostgreSQL Schema for GEOAlerts (Free Tier Cloud Option)

CREATE TABLE IF NOT EXISTS countries (
  iso2 TEXT PRIMARY KEY,
  iso3 TEXT,
  num TEXT,
  name TEXT NOT NULL,
  slug TEXT,
  region TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  overall_level INTEGER DEFAULT 1,
  max_source_level INTEGER DEFAULT 1,
  active_red_flags INTEGER DEFAULT 0,
  resonance_count INTEGER DEFAULT 0,
  last_escalation_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  ai_executive_summary TEXT
);

CREATE TABLE IF NOT EXISTS source_statuses (
  id TEXT PRIMARY KEY,
  iso2 TEXT NOT NULL REFERENCES countries(iso2) ON DELETE CASCADE,
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
  red_flags_json JSONB DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_events (
  id BIGSERIAL PRIMARY KEY,
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
  red_flags_json JSONB DEFAULT '[]'::jsonb,
  diff_before TEXT,
  diff_after TEXT,
  source_url TEXT,
  notified_telegram BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_subscribers (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  mode TEXT DEFAULT 'all',
  selected_countries_json JSONB DEFAULT '[]'::jsonb,
  min_level INTEGER DEFAULT 4,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
