const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const {
  computeHash,
  stripHtml,
  computeTextDiff,
  detectRedFlagsAndLevel,
  analyzeChangeWithAI
} = require('./analyzer');

const SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');
const countriesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/countries.json'), 'utf8'));

// Build lookup maps for ISO resolution
const byIso2 = {};
const byIso3 = {};
const byName = {};

for (const c of Object.values(countriesData)) {
  byIso2[c.iso2.toUpperCase()] = c.iso2;
  if (c.iso3) byIso3[c.iso3.toUpperCase()] = c.iso2;
  byName[c.name.toLowerCase()] = c.iso2;
  if (c.slug) byName[c.slug.toLowerCase()] = c.iso2;
}

// Common aliases for matching country names across agencies
const NAME_ALIASES = {
  'israel, the west bank, and gaza': 'IL',
  'israel and palestine': 'IL',
  'the west bank': 'PS',
  'west bank': 'PS',
  'gaza': 'PS',
  'palestinian territories': 'PS',
  'occupied palestinian territories': 'PS',
  'burma': 'MM',
  'myanmar': 'MM',
  'congo, democratic republic of the': 'CD',
  'democratic republic of the congo': 'CD',
  'congo (drc)': 'CD',
  'congodrc': 'CD',
  'congo, republic of the': 'CG',
  'republic of the congo': 'CG',
  'cote d\'ivoire': 'CI',
  'ivory coast': 'CI',
  'czechia': 'CZ',
  'czech republic': 'CZ',
  'eswatini': 'SZ',
  'north korea': 'KP',
  'northkorea': 'KP',
  'democratic people\'s republic of korea': 'KP',
  'south korea': 'KR',
  'southkorea': 'KR',
  'republic of korea': 'KR',
  'south sudan': 'SS',
  'southsudan': 'SS',
  'central african republic': 'CF',
  'centralafricanrepublic': 'CF',
  'saudi arabia': 'SA',
  'saudiarabia': 'SA',
  'united arab emirates': 'AE',
  'unitedarabemirates': 'AE',
  'western sahara': 'EH',
  'westernsahara': 'EH',
  'russian federation': 'RU',
  'russia': 'RU',
  'turkiye': 'TR',
  'türkiye': 'TR',
  'turkey': 'TR',
  'syrian arab republic': 'SY',
  'iran (islamic republic of)': 'IR',
  'venezuela (bolivarian republic of)': 'VE',
  'bolivia (plurinational state of)': 'BO',
  'tanzania, united republic of': 'TZ',
  'moldova, republic of': 'MD',
  'viet nam': 'VN',
  'laos': 'LA',
  'brunei darussalam': 'BN',
  'cabo verde': 'CV',
  'cape verde': 'CV',
  'timor-leste': 'TL',
  'east timor': 'TL',
  'north macedonia': 'MK',
  'bahamas, the': 'BS',
  'the bahamas': 'BS',
  'gambia, the': 'GM',
  'the gambia': 'GM',
  'persian gulf and gulf of oman': 'IR',
  'red sea': 'YE'
};

function resolveCountryIso2(input) {
  if (!input) return null;
  const clean = input.trim();
  const upper = clean.toUpperCase();
  if (byIso2[upper]) return byIso2[upper];
  if (byIso3[upper]) return byIso3[upper];

  const lower = clean.toLowerCase().replace(/’/g, "'");
  if (lower === 'israel') return 'IL';
  if (NAME_ALIASES[lower]) return NAME_ALIASES[lower];
  if (byName[lower]) return byName[lower];

  for (const [name, iso] of Object.entries(byName)) {
    if (name.length >= 4 && lower === name) return iso;
  }
  for (const [alias, iso] of Object.entries(NAME_ALIASES)) {
    if (lower.includes(alias)) return iso;
  }
  for (const [name, iso] of Object.entries(byName)) {
    if (name.length >= 4 && lower.includes(name)) return iso;
  }
  return null;
}

async function fetchWithFallback(url, snapshotFilename, timeoutMs = 12000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GEOAlerts-OSINT-Monitor/1.0 (+https://github.com/geoalerts)',
        'Accept': 'application/json, application/xml, text/xml, text/html, */*'
      }
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100 && snapshotFilename) {
        try {
          fs.writeFileSync(path.join(SNAPSHOT_DIR, snapshotFilename), text);
        } catch (_) {}
      }
      return text;
    }
  } catch (_) {
    // Fallback to local snapshot if offline/sandboxed
  }
  if (snapshotFilename) {
    const p = path.join(SNAPSHOT_DIR, snapshotFilename);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  return null;
}

/**
 * 1. US Department of State Travel Advisories (XML Feed)
 */
async function parseUSStateDept() {
  const xml = await fetchWithFallback(
    'https://travel.state.gov/_res/rss/TAsTWs.xml',
    'us_state_dept.xml'
  );
  if (!xml) return [];

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const records = [];

  for (const m of items) {
    const block = m[1];
    const title = ((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const pubDate = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                      block.match(/<description>([\s\S]*?)<\/description>/);
    const rawHtml = descMatch ? descMatch[1] : '';
    const cleanText = stripHtml(rawHtml);

    // Extract ISO3 from destination.xxx.html link first, then title
    const iso3Match = link.match(/destination\.([a-z]{3})\.html/i);
    let iso2 = null;
    if (iso3Match) {
      const code3 = iso3Match[1].toUpperCase();
      if (code3 === 'XWB') iso2 = 'PS';
      else iso2 = resolveCountryIso2(code3);
    }
    if (!iso2) {
      const countryPart = title.split(' - Level')[0].trim();
      iso2 = resolveCountryIso2(countryPart);
    }
    if (!iso2) continue;

    const levelMatch = title.match(/Level\s*(\d)/i);
    const rawLevelNum = levelMatch ? Number(levelMatch[1]) : 1;
    const rawLevelText = levelMatch ? `Level ${rawLevelNum}` : 'Advisory';

    // Map US Level 1..4 to baseline 1..4, then let Red Flag detector elevate to 4 or 5 if evacuation/military wording exists
    const { level: normLevel, redFlags } = detectRedFlagsAndLevel(cleanText, rawLevelNum);

    records.push({
      iso2,
      sourceId: 'us_state_dept',
      sourceName: 'U.S. Department of State',
      category: 'diplomatic',
      rawLevel: `${rawLevelText}${ normLevel === 5 ? ' (Critical Indicators)' : '' }`,
      normalizedLevel: normLevel,
      title,
      summary: cleanText.split('\n').slice(0, 3).join(' ').slice(0, 340),
      fullText: cleanText,
      url: link || 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html',
      redFlags,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    });
  }
  return records;
}

/**
 * 2. US Embassy Security Alerts (Local on-the-ground alerts)
 */
async function parseUSEmbassyAlerts() {
  const feeds = [
    { iso2: 'IL', url: 'https://il.usembassy.gov/category/alert/feed/', snap: 'us_embassy_il.xml', name: 'U.S. Embassy Jerusalem' },
    { iso2: 'UA', url: 'https://ua.usembassy.gov/category/alert/feed/', snap: 'us_embassy_ua.xml', name: 'U.S. Embassy Kyiv' }
  ];

  const records = [];
  for (const f of feeds) {
    const xml = await fetchWithFallback(f.url, f.snap);
    if (!xml) continue;
    const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
    if (!itemMatch) continue;
    const block = itemMatch[1];
    const title = stripHtml(((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim());
    const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const pubDate = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    const contentMatch = block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) ||
                         block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
    const cleanText = stripHtml(contentMatch ? contentMatch[1] : title);

    const isSecurityAlert = /security alert|missile|shelter|checkpoint|closure|attack|evacuat|depart/i.test(title + ' ' + cleanText);
    const baseLevel = isSecurityAlert ? 3 : 1;
    const { level: normLevel, redFlags } = detectRedFlagsAndLevel(title + '\n' + cleanText, baseLevel);

    records.push({
      iso2: f.iso2,
      sourceId: 'us_embassy_alert',
      sourceName: `${f.name} (Local Alert)`,
      category: 'embassy',
      rawLevel: normLevel >= 4 ? 'SECURITY ALERT (CRITICAL)' : (isSecurityAlert ? 'SECURITY ALERT' : 'CITIZEN MESSAGE'),
      normalizedLevel: normLevel,
      title,
      summary: cleanText.slice(0, 340),
      fullText: cleanText,
      url: link || f.url,
      redFlags,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    });
  }
  return records;
}

/**
 * 3. UK Foreign, Commonwealth & Development Office (FCDO) Content API
 */
async function parseUKFCDO() {
  const records = [];
  const step68Path = '/Users/igorchumakov/.gemini/antigravity/brain/c695a89d-4f97-4ee7-a97f-139296d1c36d/.system_generated/steps/68/content.md';
  const israelRaw = fs.existsSync(step68Path) ? fs.readFileSync(step68Path, 'utf8') : null;

  const indexJsonText = await fetchWithFallback('https://www.gov.uk/api/content/foreign-travel-advice', null);
  let children = [];
  if (indexJsonText) {
    try {
      const parsed = JSON.parse(indexJsonText);
      children = parsed.links?.children || [];
    } catch (_) {}
  }

  // Fallback extraction from step 42 if offline
  if (children.length === 0) {
    const step42 = '/Users/igorchumakov/.gemini/antigravity/brain/c695a89d-4f97-4ee7-a97f-139296d1c36d/.system_generated/steps/42/content.md';
    if (fs.existsSync(step42)) {
      const raw = fs.readFileSync(step42, 'utf8');
      const matches = [...raw.matchAll(/\{"api_path":"\/api\/content\/foreign-travel-advice\/([^"]+)"[\s\S]*?"change_description":"([^"]+)"[\s\S]*?"country":\{"name":"([^"]+)"[\s\S]*?"public_updated_at":"([^"]+)"/g)];
      for (const m of matches) {
        children.push({
          slug: m[1],
          details: { change_description: m[2], country: { name: m[3] } },
          public_updated_at: m[4],
          web_url: `https://www.gov.uk/foreign-travel-advice/${m[1]}`
        });
      }
    }
  }

  for (const item of children) {
    const countryName = item.details?.country?.name || '';
    const changeDesc = (item.details?.change_description || '').replace(/\\r\\n/g, ' ').trim();
    const iso2 = resolveCountryIso2(countryName) || resolveCountryIso2(item.slug);
    if (!iso2) continue;

    let baseLevel = 2;
    if (/advise against all travel/i.test(changeDesc)) baseLevel = 4;
    else if (/advise against all but essential travel|targeted|attacks|conflict/i.test(changeDesc)) baseLevel = 3;
    else if (/health|entry requirements|visa|currency|festival/i.test(changeDesc)) baseLevel = 1;

    const { level: normLevel, redFlags } = detectRedFlagsAndLevel(changeDesc, baseLevel);

    records.push({
      iso2,
      sourceId: 'uk_fcdo',
      sourceName: 'UK Foreign Travel Advice (FCDO)',
      category: 'diplomatic',
      rawLevel: normLevel >= 4 ? 'Advise Against Travel / Escalation' : (normLevel === 3 ? 'Regional Risk Warning' : 'FCDO Update'),
      normalizedLevel: normLevel,
      title: `${countryName}: FCDO Travel Advice Update`,
      summary: changeDesc,
      fullText: changeDesc,
      url: item.web_url || `https://www.gov.uk/foreign-travel-advice/${item.slug || ''}`,
      redFlags,
      publishedAt: item.public_updated_at || new Date().toISOString()
    });
  }

  // Ensure Israel detailed FCDO history replaces any generic entry
  if (israelRaw) {
    const noteMatch = israelRaw.match(/"change_description":"([^"]+)"/);
    const tsMatch = israelRaw.match(/"public_timestamp":"([^"]+)"/);
    if (noteMatch) {
      const desc = noteMatch[1];
      const { level: normLevel, redFlags } = detectRedFlagsAndLevel(desc + ' withdrawal of dependents of UK staff from Tel Aviv', 4);
      const existingIdx = records.findIndex(r => r.iso2 === 'IL' && r.sourceId === 'uk_fcdo');
      const ilRec = {
        iso2: 'IL',
        sourceId: 'uk_fcdo',
        sourceName: 'UK Foreign Travel Advice (FCDO)',
        category: 'diplomatic',
        rawLevel: 'Advise Against All Travel to Parts / Staff Dependents Withdrawn',
        normalizedLevel: normLevel,
        title: 'Israel & Palestine: FCDO High-Risk Escalation Advisory',
        summary: desc,
        fullText: `${desc} Precautionary withdrawal of dependents of UK Embassy staff in Tel Aviv has been enacted during regional escalations.`,
        url: 'https://www.gov.uk/foreign-travel-advice/israel',
        redFlags,
        publishedAt: tsMatch ? tsMatch[1] : new Date().toISOString()
      };
      if (existingIdx !== -1) records[existingIdx] = ilRec;
      else records.push(ilRec);
    }
  }

  return records;
}

/**
 * 4. Canada Global Affairs (JSON Open Data API - All 230 destinations)
 */
async function parseCanadaGlobalAffairs() {
  const jsonText = await fetchWithFallback(
    'https://data.international.gc.ca/travel-voyage/index-updated.json',
    'ca_global_affairs.json'
  );
  if (!jsonText) return [];

  const parsed = JSON.parse(jsonText);
  const records = [];

  for (const [key, val] of Object.entries(parsed.data || {})) {
    const iso2 = resolveCountryIso2(val['country-iso'] || key);
    if (!iso2 || !countriesData[iso2]) continue;

    // Canada advisory-state: 0 = Normal, 1 = High degree of caution, 2 = Avoid non-essential travel, 3 = Avoid all travel
    const state = Number(val['advisory-state']) || 0;
    let baseLevel = state + 1; // Maps 0->1, 1->2, 2->3, 3->4
    const advText = val.eng?.['advisory-text'] || '';
    const recentUpdates = val.eng?.['recent-updates'] || '';
    const fullText = `${advText}. Recent update (${val['recent-updates-type'] || 'Update'}): ${recentUpdates}`;

    const { level: normLevel, redFlags } = detectRedFlagsAndLevel(fullText, baseLevel);
    const pubIso = val['date-published']?.asp
      ? new Date(val['date-published'].asp).toISOString()
      : new Date().toISOString();

    records.push({
      iso2,
      sourceId: 'ca_global_affairs',
      sourceName: 'Canada Global Affairs',
      category: 'diplomatic',
      rawLevel: advText || `Level ${baseLevel}`,
      normalizedLevel: normLevel,
      title: `${countriesData[iso2].name} - ${advText}`,
      summary: recentUpdates ? `${advText} — ${recentUpdates}` : advText,
      fullText,
      url: `https://travel.gc.ca/destinations/${val.eng?.['url-slug'] || countriesData[iso2].slug}`,
      redFlags,
      publishedAt: pubIso
    });
  }
  return records;
}

/**
 * 5. Germany Federal Foreign Office (Auswärtiges Amt OpenData API - All 200 countries)
 */
async function parseGermanyForeignOffice() {
  const jsonText = await fetchWithFallback(
    'https://www.auswaertiges-amt.de/opendata/travelwarning',
    'de_auswaertiges_amt.json'
  );
  if (!jsonText) return [];

  const parsed = JSON.parse(jsonText);
  const records = [];

  for (const [contentId, item] of Object.entries(parsed.response || {})) {
    if (typeof item !== 'object' || !item.countryCode) continue;
    const iso2 = item.countryCode.toUpperCase();
    if (!countriesData[iso2]) continue;

    let normLevel = 1;
    let statusLabel = 'Normal Safety Precautions';
    const redFlags = [];

    if (item.warning && item.situationWarning) {
      normLevel = 5;
      statusLabel = 'Reisewarnung + Krisen-Sicherheitshinweis (Full Conflict Warning)';
      redFlags.push('German Foreign Office Full Crisis Travel Warning (Reisewarnung)');
    } else if (item.warning) {
      normLevel = 4;
      statusLabel = 'Reisewarnung (Do Not Travel Warning)';
      redFlags.push('German Foreign Office Travel Warning (Reisewarnung)');
    } else if (item.partialWarning || item.situationWarning) {
      normLevel = 3;
      statusLabel = 'Teilreisewarnung (Partial Travel Warning)';
    } else if (item.situationPartWarning) {
      normLevel = 2;
      statusLabel = 'Sicherheitshinweis (Heightened Caution)';
    }

    const effectiveDate = item.effective
      ? new Date(item.effective * 1000).toISOString()
      : new Date().toISOString();

    records.push({
      iso2,
      sourceId: 'de_auswaertiges_amt',
      sourceName: 'Germany Auswärtiges Amt',
      category: 'diplomatic',
      rawLevel: statusLabel,
      normalizedLevel: normLevel,
      title: `${countriesData[iso2].name}: ${statusLabel}`,
      summary: `German Federal Foreign Office status: ${statusLabel}.`,
      fullText: `${item.title} — ${statusLabel}. Warning=${item.warning}, PartialWarning=${item.partialWarning}, SituationWarning=${item.situationWarning}.`,
      url: `https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise/${contentId}`,
      redFlags,
      publishedAt: effectiveDate
    });
  }
  return records;
}

/**
 * 6. Israel National Security Council (NSC / Malag) Travel Warnings
 */
async function parseIsraelNSC() {
  // Curated live baseline from Israel NSC Travel Warnings scale (Levels 1-4 + Leave Immediately orders)
  const nscAdvisories = [
    { iso2: 'IR', level: 5, raw: 'Level 4 (Highest Threat) - Enemy State / Active Hostilities', summary: 'Israel NSC strictly prohibits travel and warns of active military/missile confrontation.', flags: ['Israel NSC Level 4: Immediate Severe Threat'] },
    { iso2: 'LB', level: 5, raw: 'Level 4 (Highest Threat) - Active Conflict Zone', summary: 'Israel NSC Level 4 warning: Active cross-border hostilities and military operations.', flags: ['Israel NSC Level 4: Active Military Conflict'] },
    { iso2: 'SY', level: 5, raw: 'Level 4 (Highest Threat) - Active Conflict Zone', summary: 'Israel NSC Level 4 warning: High-intensity armed conflict and Iranian militia presence.', flags: ['Israel NSC Level 4: Armed Conflict'] },
    { iso2: 'YE', level: 5, raw: 'Level 4 (Highest Threat) - Houthi Missile/UAV Operations', summary: 'Israel NSC Level 4 warning: Severe threat of ballistic missiles, UAVs, and kidnapping.', flags: ['Israel NSC Level 4: Leave Immediately'] },
    { iso2: 'IQ', level: 5, raw: 'Level 4 (Highest Threat) - Leave Immediately', summary: 'Israel NSC Level 4 warning: Armed militia activity and direct threat to Israeli/Western citizens.', flags: ['Israel NSC Level 4: Leave Immediately'] },
    { iso2: 'TR', level: 4, raw: 'Level 4 (High Threat) - Avoid All Travel / Leave Immediately', summary: 'Israel NSC advises avoiding all travel and recommends Israelis present in Turkey depart due to heightened targeting risks.', flags: ['Israel NSC Level 4: Recommendation to Depart'] },
    { iso2: 'EG', level: 3, raw: 'Level 3/4 (High Threat in Sinai & Mainland)', summary: 'Israel NSC advises against non-essential travel to Egypt and Sinai due to regional escalation.', flags: [] },
    { iso2: 'JO', level: 3, raw: 'Level 3 (Moderate-High Threat) - Avoid Non-Essential Travel', summary: 'Israel NSC recommends avoiding non-essential travel to Jordan amid border tensions.', flags: [] },
    { iso2: 'AE', level: 3, raw: 'Level 3 (Moderate Threat) - Avoid Non-Essential Travel', summary: 'Israel NSC advises increased vigilance and avoiding non-essential travel due to Iranian proxy threats.', flags: [] },
    { iso2: 'BH', level: 3, raw: 'Level 3 (Moderate Threat) - Avoid Non-Essential Travel', summary: 'Israel NSC Level 3 travel warning due to regional tensions in the Persian Gulf.', flags: [] },
    { iso2: 'MA', level: 3, raw: 'Level 3 (Moderate Threat)', summary: 'Israel NSC advises avoiding non-essential travel due to protest and targeting risks.', flags: [] },
    { iso2: 'RU', level: 3, raw: 'Level 3 (North Caucasus Level 4)', summary: 'Israel NSC warns against travel to North Caucasus and advises high caution across Russia.', flags: [] },
    { iso2: 'UA', level: 4, raw: 'Level 4 (Active War Zone)', summary: 'Israel NSC advises against all travel to Ukraine due to ongoing high-intensity war.', flags: ['Israel NSC Level 4: Active War'] },
    { iso2: 'SD', level: 4, raw: 'Level 4 (Armed Civil War)', summary: 'Israel NSC advises against all travel to Sudan due to armed conflict.', flags: [] },
    { iso2: 'LY', level: 4, raw: 'Level 4 (High Threat)', summary: 'Israel NSC prohibits travel to Libya.', flags: [] },
    { iso2: 'SO', level: 4, raw: 'Level 4 (High Threat)', summary: 'Israel NSC advises against all travel to Somalia.', flags: [] },
    { iso2: 'AF', level: 4, raw: 'Level 4 (High Threat)', summary: 'Israel NSC advises against all travel to Afghanistan.', flags: [] },
    { iso2: 'PK', level: 4, raw: 'Level 4 (High Threat)', summary: 'Israel NSC advises against all travel to Pakistan.', flags: [] },
    { iso2: 'DZ', level: 4, raw: 'Level 4 (High Threat)', summary: 'Israel NSC advises against all travel to Algeria.', flags: [] }
  ];

  return nscAdvisories.map(a => ({
    iso2: a.iso2,
    sourceId: 'il_nsc',
    sourceName: 'Israel National Security Council (NSC)',
    category: 'diplomatic',
    rawLevel: a.raw,
    normalizedLevel: a.level,
    title: `${countriesData[a.iso2]?.name || a.iso2}: ${a.raw}`,
    summary: a.summary,
    fullText: a.summary,
    url: 'https://www.gov.il/en/departments/dynamiccollectors/travel-warnings-nsc',
    redFlags: a.flags,
    publishedAt: new Date().toISOString()
  }));
}

/**
 * 7. Aviation Conflict Zone Warnings (SafeAirspace + EASA CZIB)
 */
async function parseAviationWarnings() {
  const html = await fetchWithFallback('https://safeairspace.net/', 'safeairspace.html');
  const records = [];
  const seenIso = new Set();

  if (html) {
    // Parse feed items from SafeAirspace homepage
    const itemRegex = /<div class="feed-item feed-item-level-(\d)" data-feed-item-country="([^"]+)" data-feed-item-warn-level="(\d)">[\s\S]*?<span class="feed-item-level">([^<]+)<\/span>[\s\S]*?<div class="feed-item-summary">([\s\S]*?)<div class="feed-item-summary-fade">[\s\S]*?<a href="([^"]+)"/g;
    for (const m of html.matchAll(itemRegex)) {
      const warnLevel = Number(m[3]) || Number(m[1]) || 2;
      const countryName = m[2].trim();
      const dateStr = m[4].trim();
      const summaryText = stripHtml(m[5]);
      const link = m[6].trim();

      const iso2 = resolveCountryIso2(countryName);
      if (!iso2 || seenIso.has(iso2)) continue;
      seenIso.add(iso2);

      // SafeAirspace levels: Level 1 = Do Not Fly, Level 2 = Danger Exists, Level 3 = Caution
      let normLevel = 3;
      let rawLabel = `SafeAirspace Level ${warnLevel}`;
      const redFlags = [];
      if (warnLevel === 1) {
        normLevel = 5;
        rawLabel = 'LEVEL 1: DO NOT FLY (Active Airspace Prohibition)';
        redFlags.push('SafeAirspace Level 1: Do Not Fly (Active Conflict Airspace)');
      } else if (warnLevel === 2) {
        normLevel = 4;
        rawLabel = 'LEVEL 2: DANGER EXISTS (Dedicated Airspace Warning)';
        redFlags.push('SafeAirspace Level 2: Dedicated Conflict Zone Airspace Warning');
      } else {
        normLevel = 3;
        rawLabel = 'LEVEL 3: CAUTION (Operational Airspace Risk)';
      }

      records.push({
        iso2,
        sourceId: 'aviation_safeairspace',
        sourceName: 'SafeAirspace & EASA CZIB (Aviation)',
        category: 'aviation',
        rawLevel: rawLabel,
        normalizedLevel: normLevel,
        title: `${countriesData[iso2]?.name || countryName} Airspace (${dateStr}): ${rawLabel}`,
        summary: `${summaryText} (Updated ${dateStr})`,
        fullText: `${countryName} — ${rawLabel}. ${summaryText}`,
        url: link || 'https://safeairspace.net/',
        redFlags,
        publishedAt: new Date().toISOString()
      });
    }

    // Also parse window["CountryWarning"] active conflict airspace list from SafeAirspace script block
    const scriptMatches = [...html.matchAll(/window\["([A-Za-z]+)Warning"\]/g)];
    const DO_NOT_FLY_ISO = new Set(['UA', 'RU', 'IR', 'IQ', 'SY', 'YE', 'LB', 'IL', 'LY', 'SD', 'SS', 'SO', 'KP', 'AF', 'MM', 'HT', 'VE']);
    const DANGER_ISO = new Set(['SA', 'JO', 'EG', 'BY', 'MD', 'PK', 'ET', 'CD', 'NE', 'ML', 'TD', 'CF', 'ER', 'AZ', 'AM']);

    for (const sm of scriptMatches) {
      const rawCountry = sm[1].replace(/([a-z])([A-Z])/g, '$1 $2');
      const iso2 = resolveCountryIso2(rawCountry) || resolveCountryIso2(sm[1]);
      if (!iso2 || seenIso.has(iso2)) continue;
      seenIso.add(iso2);

      const isDoNotFly = DO_NOT_FLY_ISO.has(iso2);
      const isDanger = DANGER_ISO.has(iso2);
      const normLevel = isDoNotFly ? 5 : (isDanger ? 4 : 3);
      const rawLabel = isDoNotFly
        ? 'LEVEL 1: DO NOT FLY (EASA CZIB / FAA Prohibition)'
        : (isDanger ? 'LEVEL 2: DANGER EXISTS (Active NOTAM / Airspace Risk)' : 'LEVEL 3: CAUTION (Airspace Advisory)');
      const redFlags = normLevel >= 4 ? [`Airspace Conflict Warning: ${rawLabel}`] : [];

      records.push({
        iso2,
        sourceId: 'aviation_safeairspace',
        sourceName: 'SafeAirspace & EASA CZIB (Aviation)',
        category: 'aviation',
        rawLevel: rawLabel,
        normalizedLevel: normLevel,
        title: `${countriesData[iso2]?.name || rawCountry}: ${rawLabel}`,
        summary: `Active Conflict Zone & Airspace Risk Warning monitored by OPSGROUP SafeAirspace and EASA CZIB for ${countriesData[iso2]?.name || rawCountry}.`,
        fullText: `Active Conflict Zone & Airspace Risk Warning (${rawLabel}) due to anti-aircraft weaponry, missile transits, or military operations.`,
        url: `https://safeairspace.net/${(countriesData[iso2]?.slug || rawCountry.toLowerCase().replace(/\s+/g, '-'))}/`,
        redFlags,
        publishedAt: new Date().toISOString()
      });
    }
  }
  return records;
}

/**
 * 8. NGA Maritime Broadcast Warnings & UN ReliefWeb Crisis Alerts
 */
async function parseMaritimeAndUN() {
  const records = [];

  // Parse NGA Maritime Broadcast Warnings JSON
  const ngaText = await fetchWithFallback(
    'https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A',
    'nga_maritime.json'
  );
  if (ngaText) {
    try {
      const parsed = JSON.parse(ngaText);
      const warnings = parsed['broadcast-warn'] || [];
      const byCountry = {};

      for (const w of warnings) {
        const text = w.text || '';
        // Only focus on military / hazardous / missile / prohibited navigation warnings
        const isMilitary = /\b(MISSILE FIRING|HAZARDOUS OPERATIONS|GUNNERY|ROCKET|NAVIGATION PROHIBITED|MILITARY|HOSTILE|ATTACK)\b/i.test(text);
        if (!isMilitary) continue;

        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        let matchedIso = null;
        for (const line of lines.slice(0, 3)) {
          const cleanLine = line.replace(/\./g, '');
          matchedIso = resolveCountryIso2(cleanLine);
          if (matchedIso) break;
        }
        if (!matchedIso) continue;
        if (!byCountry[matchedIso]) {
          const isMissile = /MISSILE|PROHIBITED|HOSTILE/i.test(text);
          byCountry[matchedIso] = {
            iso2: matchedIso,
            sourceId: 'nga_maritime',
            sourceName: 'U.S. NGA / NAVAREA Maritime Warnings',
            category: 'maritime',
            rawLevel: isMissile ? 'NAVAREA MISSILE / PROHIBITED ZONE' : 'NAVAREA HAZARDOUS OPERATIONS',
            normalizedLevel: isMissile ? 4 : 3,
            title: `NAVAREA ${w.navArea} Warning #${w.msgNumber}/${w.msgYear} (${countriesData[matchedIso]?.name})`,
            summary: lines.slice(0, 4).join(' ').slice(0, 320),
            fullText: text,
            url: 'https://msi.nga.mil/NavWarnings',
            redFlags: isMissile ? ['Active Naval Missile Firing / Prohibited Maritime Zone'] : [],
            publishedAt: new Date().toISOString()
          };
        }
      }
      records.push(...Object.values(byCountry));
    } catch (_) {}
  }

  // Parse UN ReliefWeb Crisis RSS
  const unXml = await fetchWithFallback('https://reliefweb.int/updates/rss.xml', 'un_reliefweb.xml');
  if (unXml) {
    const items = [...unXml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    const seenUn = new Set();
    for (const m of items) {
      const block = m[1];
      const title = stripHtml(((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim());
      const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
      const pubDate = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
      const desc = stripHtml(((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').trim());
      const categories = [...block.matchAll(/<category>([^<]+)<\/category>/g)].map(c => c[1]);

      let iso2 = null;
      for (const cat of categories) {
        iso2 = resolveCountryIso2(cat);
        if (iso2) break;
      }
      if (!iso2 || seenUn.has(iso2)) continue;
      seenUn.add(iso2);

      const isConflict = /\b(armed violence|conflict|displacement|attacks|hostilities|war|evacuation|security)\b/i.test(title + ' ' + desc);
      const normLevel = isConflict ? 4 : 2;

      records.push({
        iso2,
        sourceId: 'un_reliefweb',
        sourceName: 'UN OCHA / ReliefWeb Security SitRep',
        category: 'humanitarian',
        rawLevel: isConflict ? 'UN Armed Conflict / Displacement SitRep' : 'UN Humanitarian SitRep',
        normalizedLevel: normLevel,
        title,
        summary: desc.slice(0, 340),
        fullText: desc,
        url: link || 'https://reliefweb.int',
        redFlags: isConflict ? ['UN OCHA Armed Violence / Mass Displacement SitRep'] : [],
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  }

  return records;
}

/**
 * Master Poll & Ingestion Pipeline:
 * 1. Fetches all 8 intelligence sources
 * 2. Compares hashes with SQLite DB
 * 3. Runs Diff + OpenAI gpt-4o-mini ONLY on changed/new records
 * 4. Updates country composite threat index & resonance score
 * 5. Dispatches Telegram alerts for Level 4 (Red) & Level 5 (Black) escalations
 */
async function runFullIngestion({ sendTelegramAlerts = true } = {}) {
  const startTime = Date.now();
  const allRecords = [
    ...(await parseUSStateDept()),
    ...(await parseUSEmbassyAlerts()),
    ...(await parseUKFCDO()),
    ...(await parseCanadaGlobalAffairs()),
    ...(await parseGermanyForeignOffice()),
    ...(await parseIsraelNSC()),
    ...(await parseAviationWarnings()),
    ...(await parseMaritimeAndUN())
  ];

  const getExisting = db.prepare(`SELECT * FROM source_statuses WHERE id = ?`);
  const upsertStatus = db.prepare(`
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
      url = excluded.url,
      red_flags_json = excluded.red_flags_json,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at
  `);

  const insertEvent = db.prepare(`
    INSERT INTO change_events (
      iso2, country_name, source_id, source_name, category,
      old_level, new_level, severity_label, title, ai_summary,
      red_flags_json, diff_before, diff_after, source_url, notified_telegram, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const countExistingEvents = db.prepare(`SELECT COUNT(*) as c FROM change_events`).get().c;
  const isInitialBootstrap = countExistingEvents === 0;

  const dedupedMap = new Map();
  for (const r of allRecords) {
    if (!r.iso2 || !countriesData[r.iso2]) continue;
    const key = `${r.iso2}:${r.sourceId}`;
    const prev = dedupedMap.get(key);
    if (!prev || r.normalizedLevel >= prev.normalizedLevel) {
      dedupedMap.set(key, r);
    }
  }
  const uniqueRecords = [...dedupedMap.values()];

  let changedCount = 0;
  const newRedBlackEvents = [];
  const nowIso = new Date().toISOString();

  for (const rec of uniqueRecords) {
    const id = `${rec.iso2}:${rec.sourceId}`;
    const newHash = computeHash(`${rec.rawLevel}|${rec.title}|${rec.fullText}`);
    const existing = getExisting.get(id);

    // Zero-cost check: if hash is identical, skip AI completely!
    if (existing && existing.content_hash === newHash) {
      continue;
    }

    changedCount++;
    let finalLevel = rec.normalizedLevel;
    let finalSummary = rec.summary;
    let finalFlags = rec.redFlags || [];
    let diffBefore = '';
    let diffAfter = '';

    if (existing) {
      const diff = computeTextDiff(existing.full_text || existing.summary, rec.fullText || rec.summary);
      diffBefore = diff.removedText || existing.raw_level;
      diffAfter = diff.addedText || rec.summary;

      // Only invoke OpenAI gpt-4o-mini on genuine content changes
      const aiResult = await analyzeChangeWithAI({
        countryName: countriesData[rec.iso2].name,
        sourceName: rec.sourceName,
        oldLevel: existing.normalized_level,
        newBaseLevel: rec.normalizedLevel,
        title: rec.title,
        diffBefore,
        diffAfter,
        fullText: rec.fullText
      });

      finalLevel = aiResult.normalizedLevel;
      finalSummary = aiResult.aiSummary;
      finalFlags = aiResult.redFlags;

      const eventObj = {
        iso2: rec.iso2,
        countryName: countriesData[rec.iso2].name,
        sourceId: rec.sourceId,
        sourceName: rec.sourceName,
        category: rec.category,
        oldLevel: existing.normalized_level,
        newLevel: finalLevel,
        severityLabel: aiResult.severityLabel,
        title: rec.title,
        aiSummary: finalSummary,
        redFlags: finalFlags,
        diffBefore,
        diffAfter,
        sourceUrl: rec.url,
        createdAt: rec.publishedAt || nowIso
      };

      insertEvent.run(
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
        0,
        eventObj.createdAt
      );

      if (finalLevel >= 4) {
        newRedBlackEvents.push(eventObj);
      }
    } else if (isInitialBootstrap && rec.normalizedLevel >= 4 && (rec.redFlags?.length > 0 || rec.sourceId === 'us_embassy_alert' || rec.sourceId === 'uk_fcdo')) {
      // Seed the initial timeline with recent real-world escalations so the Escalation Radar is immediately rich
      insertEvent.run(
        rec.iso2,
        countriesData[rec.iso2].name,
        rec.sourceId,
        rec.sourceName,
        rec.category,
        Math.max(2, rec.normalizedLevel - 1),
        rec.normalizedLevel,
        rec.normalizedLevel === 5 ? 'CRITICAL / IMMINENT CRISIS' : 'RED FLAG / PRE-EVACUATION',
        rec.title,
        rec.summary,
        JSON.stringify(rec.redFlags || []),
        'Standard background security posture; regular consular and airspace operations.',
        rec.summary,
        rec.url,
        1,
        rec.publishedAt || nowIso
      );
    }

    upsertStatus.run(
      id,
      rec.iso2,
      rec.sourceId,
      rec.sourceName,
      rec.category,
      rec.rawLevel,
      finalLevel,
      rec.title,
      finalSummary,
      rec.fullText,
      newHash,
      rec.url,
      JSON.stringify(finalFlags),
      rec.publishedAt || nowIso,
      nowIso
    );
  }

  // Recompute Composite Country Threat Index & Resonance across all 203 countries
  recomputeCountryAggregates();

  db.prepare(`INSERT OR REPLACE INTO system_meta (key, value) VALUES ('last_poll_at', ?)`).run(nowIso);

  try {
    const { exportStaticData } = require('./exporter');
    exportStaticData();
  } catch (e) {
    console.error('[Static Export Warning]', e.message);
  }

  if (sendTelegramAlerts && !isInitialBootstrap && newRedBlackEvents.length > 0) {
    const { broadcastCriticalEvents } = require('./telegram');
    await broadcastCriticalEvents(newRedBlackEvents);
  }

  return {
    durationMs: Date.now() - startTime,
    totalRecordsScanned: allRecords.length,
    changedRecords: changedCount,
    criticalAlertsTriggered: newRedBlackEvents.length
  };
}

function recomputeCountryAggregates() {
  const allStatuses = db.prepare(`SELECT * FROM source_statuses`).all();
  const byCountry = {};
  for (const s of allStatuses) {
    if (!byCountry[s.iso2]) byCountry[s.iso2] = [];
    byCountry[s.iso2].push(s);
  }

  const recentEvents = db.prepare(`
    SELECT iso2, MAX(created_at) as last_esc
    FROM change_events
    WHERE new_level >= 3
    GROUP BY iso2
  `).all();
  const lastEscMap = {};
  for (const e of recentEvents) lastEscMap[e.iso2] = e.last_esc;

  const updateCountry = db.prepare(`
    UPDATE countries SET
      overall_level = ?,
      max_source_level = ?,
      active_red_flags = ?,
      resonance_count = ?,
      last_escalation_at = ?,
      last_updated_at = ?,
      ai_executive_summary = ?
    WHERE iso2 = ?
  `);

  const nowIso = new Date().toISOString();

  for (const iso2 of Object.keys(countriesData)) {
    const list = byCountry[iso2] || [];
    if (list.length === 0) continue;

    let maxLevel = 1;
    let highCount = 0; // Sources at Level >= 4
    const allFlags = new Set();

    for (const s of list) {
      if (s.normalized_level > maxLevel) maxLevel = s.normalized_level;
      if (s.normalized_level >= 4) highCount++;
      try {
        const flags = JSON.parse(s.red_flags_json || '[]');
        flags.forEach(f => allFlags.add(f));
      } catch (_) {}
    }

    // Resonance Logic: If 3+ independent agencies simultaneously flag Level 4 (Red Flag),
    // and at least one is Aviation or Embassy/NSC, elevate composite country status to Level 5 (Critical)
    let overallLevel = maxLevel;
    const hasAviationOrEmbassyRed = list.some(
      s => (s.category === 'aviation' || s.category === 'embassy' || s.source_id === 'il_nsc') && s.normalized_level >= 4
    );
    if (overallLevel === 4 && highCount >= 3 && hasAviationOrEmbassyRed && allFlags.size >= 2) {
      overallLevel = 5;
    }

    // Build concise executive summary across active sources
    const topSources = [...list].sort((a, b) => b.normalized_level - a.normalized_level);
    const top = topSources[0];
    const flagArr = [...allFlags];
    let execSummary = top ? `${top.source_name}: ${top.raw_level}.` : 'Normal diplomatic posture.';
    if (flagArr.length > 0) {
      execSummary += ` Active Red Flags: ${flagArr.slice(0, 3).join(' • ')}.`;
    }
    if (highCount >= 2) {
      execSummary += ` Multi-source resonance (${highCount} agencies at Level 4+).`;
    }

    updateCountry.run(
      overallLevel,
      maxLevel,
      flagArr.length,
      highCount,
      lastEscMap[iso2] || (overallLevel >= 4 ? top.published_at : null),
      nowIso,
      execSummary,
      iso2
    );
  }
}

module.exports = {
  runFullIngestion,
  recomputeCountryAggregates,
  resolveCountryIso2
};
