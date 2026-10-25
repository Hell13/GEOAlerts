// GEOAlerts Frontend Controller
const state = {
  mapMode: 'status', // 'status' (Global Threat Status) | 'radar' (Escalation Radar)
  filterLevel: 'all',
  searchQuery: '',
  selectedIso2: null,
  countries: [],
  countriesByIso2: {},
  countriesByNum: {},
  countriesByName: {},
  recentEvents: [],
  watchedCountries: new Set(['UA', 'IL', 'LB', 'IR', 'TW', 'RS', 'PL', 'MD', 'KP', 'KR']),
  tgMode: 'all',
  tgChatId: 'admin_profile',
  worldFeatures: []
};

const LEVEL_COLORS = {
  5: '#dc2626', // Critical / Imminent War (Crimson Red-Black)
  4: '#ef4444', // Red Flag / Pre-Evacuation
  3: '#ea580c', // High Risk (Orange)
  2: '#ca8a04', // Increased Caution (Amber/Yellow)
  1: '#059669', // Normal Precautions (Emerald Green)
  0: '#1e293b'
};

const LEVEL_LABELS = {
  5: 'CRITICAL / IMMINENT CRISIS',
  4: 'RED FLAG / PRE-EVACUATION',
  3: 'HIGH RISK / RECONSIDER TRAVEL',
  2: 'INCREASED CAUTION',
  1: 'NORMAL PRECAUTIONS'
};

let svg, gMap, gPulses, projection, pathGenerator, zoomBehavior;

document.addEventListener('DOMContentLoaded', async () => {
  bindUIEvents();
  await initMapGeometry();
  await loadOverviewData();
  await loadTelegramSettings();

  // Select a high-interest country by default so the right panel is immediately informative
  if (state.countriesByIso2['IL']) {
    selectCountry('IL');
  } else if (state.countries.length > 0) {
    selectCountry(state.countries[0].iso2);
  }
});

function bindUIEvents() {
  // Map Mode Switcher
  document.getElementById('btnModeStatus').addEventListener('click', () => setMapMode('status'));
  document.getElementById('btnModeRadar').addEventListener('click', () => setMapMode('radar'));

  // Level Filter Ribbon
  document.querySelectorAll('.lvl-card').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lvl-card').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterLevel = btn.dataset.filterLevel;
      renderCountriesList();
      updateMapColors();
    });
  });

  // Left Panel Tabs
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.leftTab;
      document.getElementById('leftTabCountries').classList.toggle('hidden', target !== 'countries');
      document.getElementById('leftTabFeed').classList.toggle('hidden', target !== 'feed');
    });
  });

  // Search box
  document.getElementById('countrySearchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderCountriesList();
  });

  // Poll Now
  document.getElementById('btnPollNow').addEventListener('click', async () => {
    const btn = document.getElementById('btnPollNow');
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<span>⏳ Syncing 8 Sources...</span>';
    btn.disabled = true;
    try {
      const res = await fetch('/api/poll', { method: 'POST' });
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        await loadOverviewData();
        if (state.selectedIso2) await selectCountry(state.selectedIso2);
        document.getElementById('lastPollLabel').textContent = `Synced: Just now (${data.totalRecordsScanned} records)`;
      } else {
        // Static cloud mode: reload latest exported JSON from CDN
        state.staticDetailsCache = null;
        await loadOverviewData();
        if (state.selectedIso2) await selectCountry(state.selectedIso2);
        document.getElementById('lastPollLabel').textContent = `Synced from Cloud Feed (${state.countries.length} countries)`;
      }
    } catch {
      await loadOverviewData();
    } finally {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  });

  // Modals
  document.getElementById('btnOpenSimulator').addEventListener('click', () => {
    document.getElementById('modalSimulator').classList.remove('hidden');
  });
  document.getElementById('btnOpenTelegram').addEventListener('click', () => {
    renderTelegramModalTags();
    document.getElementById('modalTelegram').classList.remove('hidden');
  });
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });

  // Run Simulation
  document.getElementById('btnRunSimulation').addEventListener('click', runCrisisSimulation);

  // Save Telegram Settings
  document.getElementById('btnSaveTelegramSettings').addEventListener('click', saveTelegramSettings);

  // Watch button in Dossier
  document.getElementById('btnToggleWatchCountry').addEventListener('click', async () => {
    if (!state.selectedIso2) return;
    if (state.watchedCountries.has(state.selectedIso2)) {
      state.watchedCountries.delete(state.selectedIso2);
    } else {
      state.watchedCountries.add(state.selectedIso2);
    }
    updateWatchButtonUI();
    await persistTelegramSettingsQuietly();
  });
}

function setMapMode(mode) {
  state.mapMode = mode;
  document.getElementById('btnModeStatus').classList.toggle('active', mode === 'status');
  document.getElementById('btnModeRadar').classList.toggle('active', mode === 'radar');

  const banner = document.getElementById('mapModeBanner');
  if (mode === 'status') {
    banner.innerHTML = '<strong>MODE: GLOBAL THREAT STATUS</strong> — Color-coded composite threat index (🟢 L1 to ⚫️ L5) across all 203 monitored destinations.';
  } else {
    banner.innerHTML = '<strong>MODE: ESCALATION RADAR (RECENT WORDING SHIFTS)</strong> — Dimming static background to highlight countries with active Red/Black Flag escalations & wording changes.';
  }

  updateMapColors();
  renderRadarPulses();
}

async function initMapGeometry() {
  const container = document.getElementById('mapContainer');
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 580;

  svg = d3.select('#worldMapSvg')
    .attr('viewBox', `0 0 ${width} ${height}`);

  // Define glow filter for Level 5 critical countries
  const defs = svg.append('defs');
  const pattern = defs.append('pattern')
    .attr('id', 'criticalStripe')
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('width', 6)
    .attr('height', 6)
    .attr('patternTransform', 'rotate(45)');
  pattern.append('rect').attr('width', 6).attr('height', 6).attr('fill', '#991b1b');
  pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).attr('stroke', '#f43f5e').attr('stroke-width', 3);

  const rootG = svg.append('g');
  gMap = rootG.append('g').attr('class', 'countries-layer');
  gPulses = rootG.append('g').attr('class', 'pulses-layer');

  projection = d3.geoNaturalEarth1()
    .scale(width / 5.6)
    .translate([width / 2, height / 1.88]);

  pathGenerator = d3.geoPath().projection(projection);

  zoomBehavior = d3.zoom()
    .scaleExtent([1, 10])
    .on('zoom', (event) => {
      rootG.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);

  document.getElementById('btnZoomIn').addEventListener('click', () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.4));
  document.getElementById('btnZoomOut').addEventListener('click', () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 0.7));
  document.getElementById('btnZoomReset').addEventListener('click', () => svg.transition().duration(350).call(zoomBehavior.transform, d3.zoomIdentity));

  // Fetch world topology from CDN
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    const worldTopo = await res.json();
    const features = topojson.feature(worldTopo, worldTopo.objects.countries).features;
    state.worldFeatures = features;
    drawMapFeatures();
  } catch (err) {
    console.error('Map TopoJSON fetch error:', err);
  }
}

function resolveFeatureCountry(feature) {
  const numId = String(feature.id || '').padStart(3, '0');
  if (state.countriesByNum[numId]) return state.countriesByNum[numId];
  const propName = (feature.properties?.name || '').toLowerCase();
  if (state.countriesByName[propName]) return state.countriesByName[propName];
  // Partial match fallback
  for (const [name, c] of Object.entries(state.countriesByName)) {
    if (propName && (name.includes(propName) || propName.includes(name))) return c;
  }
  return null;
}

function drawMapFeatures() {
  if (!gMap || state.worldFeatures.length === 0) return;

  const tooltip = document.getElementById('mapTooltip');

  gMap.selectAll('path.country-path')
    .data(state.worldFeatures)
    .join('path')
    .attr('class', 'country-path')
    .attr('d', pathGenerator)
    .on('mouseenter', (event, d) => {
      const c = resolveFeatureCountry(d);
      if (!c) return;
      const lvl = c.overall_level || 1;
      const topSources = (c.sources || []).slice(0, 4).map(s =>
        `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;margin-top:2px;">
          <span style="color:#94a3b8">${escapeHtml(s.sourceName.replace('U.S. Department of State', '🇺🇸 US State Dept').replace('UK Foreign Travel Advice (FCDO)', '🇬🇧 UK FCDO').replace('Canada Global Affairs', '🇨🇦 Canada').replace('Germany Auswärtiges Amt', '🇩🇪 Germany'))}</span>
          <strong style="color:${LEVEL_COLORS[s.level] || '#fff'}">L${s.level}</strong>
        </div>`
      ).join('');

      tooltip.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13.5px">${escapeHtml(c.name)} (${c.iso2})</strong>
          <span class="c-row-badge badge-l${lvl}">LEVEL ${lvl}</span>
        </div>
        <div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">${escapeHtml(LEVEL_LABELS[lvl])}</div>
        <div style="border-top:1px solid #1e2942;padding-top:4px;">${topSources}</div>
      `;
      tooltip.classList.remove('hidden');
    })
    .on('mousemove', (event) => {
      const rect = document.getElementById('mapContainer').getBoundingClientRect();
      let left = event.clientX - rect.left + 14;
      let top = event.clientY - rect.top + 14;
      if (left + 260 > rect.width) left -= 270;
      if (top + 140 > rect.height) top -= 140;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    })
    .on('mouseleave', () => {
      tooltip.classList.add('hidden');
    })
    .on('click', (event, d) => {
      const c = resolveFeatureCountry(d);
      if (c) selectCountry(c.iso2);
    });

  updateMapColors();
  renderRadarPulses();
}

function updateMapColors() {
  if (!gMap) return;

  const escalatedIsoSet = new Set(state.recentEvents.map(e => e.iso2));

  gMap.selectAll('path.country-path')
    .classed('selected-country', d => {
      const c = resolveFeatureCountry(d);
      return c && c.iso2 === state.selectedIso2;
    })
    .attr('fill', d => {
      const c = resolveFeatureCountry(d);
      if (!c) return '#151e30';
      const lvl = c.overall_level || 1;

      if (state.filterLevel !== 'all' && String(lvl) !== String(state.filterLevel)) {
        return '#0f1626';
      }

      if (state.mapMode === 'radar') {
        const hasEscalation = escalatedIsoSet.has(c.iso2) || (c.active_red_flags > 0 && lvl >= 4);
        if (!hasEscalation) return '#101827';
        return lvl === 5 ? 'url(#criticalStripe)' : LEVEL_COLORS[lvl];
      }

      return lvl === 5 ? 'url(#criticalStripe)' : LEVEL_COLORS[lvl];
    })
    .attr('opacity', d => {
      const c = resolveFeatureCountry(d);
      if (!c) return 0.5;
      if (state.filterLevel !== 'all' && String(c.overall_level) !== String(state.filterLevel)) {
        return 0.35;
      }
      if (state.mapMode === 'radar') {
        const hasEscalation = escalatedIsoSet.has(c.iso2) || (c.active_red_flags > 0 && c.overall_level >= 4);
        return hasEscalation ? 1 : 0.4;
      }
      return 0.92;
    });
}

function renderRadarPulses() {
  if (!gPulses || !projection) return;
  gPulses.selectAll('*').remove();

  // Show radar pulses on countries with recent escalations or Level 5 status (especially prominent in Radar Mode)
  const escalatedIsoSet = new Set(state.recentEvents.map(e => e.iso2));
  const pulseCountries = state.countries.filter(c => {
    if (!c.lat || !c.lon) return false;
    if (state.mapMode === 'radar') {
      return escalatedIsoSet.has(c.iso2) || (c.overall_level >= 4 && c.active_red_flags > 0);
    }
    return c.overall_level === 5;
  });

  for (const c of pulseCountries) {
    const coords = projection([c.lon, c.lat]);
    if (!coords) continue;

    gPulses.append('circle')
      .attr('cx', coords[0])
      .attr('cy', coords[1])
      .attr('r', 4)
      .attr('class', 'radar-pulse-circle')
      .style('stroke', c.overall_level === 5 ? '#f43f5e' : '#fb923c');

    gPulses.append('circle')
      .attr('cx', coords[0])
      .attr('cy', coords[1])
      .attr('r', 3.2)
      .attr('fill', c.overall_level === 5 ? '#fda4af' : '#fdba74')
      .style('cursor', 'pointer')
      .on('click', () => selectCountry(c.iso2));
  }
}

async function loadOverviewData() {
  let data;
  try {
    const res = await fetch('/api/overview');
    if (!res.ok) throw new Error('Static fallback');
    data = await res.json();
  } catch (_) {
    const res = await fetch('./data/overview.json');
    data = await res.json();
  }

  state.countries = data.countries || [];
  state.recentEvents = data.recentEvents || [];
  state.countriesByIso2 = {};
  state.countriesByNum = {};
  state.countriesByName = {};

  for (const c of state.countries) {
    state.countriesByIso2[c.iso2] = c;
    if (c.num) state.countriesByNum[String(c.num).padStart(3, '0')] = c;
    state.countriesByName[c.name.toLowerCase()] = c;
  }

  // Update top ribbon counts
  document.getElementById('countAll').textContent = data.totalCountries || 0;
  document.getElementById('countL5').textContent = data.levelCounts?.[5] || 0;
  document.getElementById('countL4').textContent = data.levelCounts?.[4] || 0;
  document.getElementById('countL3').textContent = data.levelCounts?.[3] || 0;
  document.getElementById('countL2').textContent = data.levelCounts?.[2] || 0;
  document.getElementById('countL1').textContent = data.levelCounts?.[1] || 0;

  populateSimulatorSelect();
  renderCountriesList();
  renderFeedList();
  updateMapColors();
  renderRadarPulses();
}

function renderCountriesList() {
  const container = document.getElementById('leftTabCountries');
  const filtered = state.countries.filter(c => {
    if (state.filterLevel !== 'all' && String(c.overall_level) !== String(state.filterLevel)) {
      return false;
    }
    if (state.searchQuery) {
      const hay = `${c.name} ${c.iso2} ${c.iso3} ${c.region} ${c.ai_executive_summary || ''}`.toLowerCase();
      if (!hay.includes(state.searchQuery)) return false;
    }
    return true;
  });

  document.getElementById('filteredCountLabel').textContent = filtered.length;

  container.innerHTML = filtered.map(c => {
    const lvl = c.overall_level || 1;
    const isSel = c.iso2 === state.selectedIso2;
    const flagText = c.active_red_flags > 0
      ? `🚩 ${c.active_red_flags} Red Flag${c.active_red_flags > 1 ? 's' : ''} • ${c.resonance_count} Agencies @ L4+`
      : (c.ai_executive_summary || c.region);

    return `
      <div class="country-row l${lvl} ${isSel ? 'selected' : ''}" data-iso="${c.iso2}">
        <div class="c-row-left">
          <div class="c-row-name">
            <span>${escapeHtml(c.name)}</span>
            <span class="c-row-iso">${c.iso2}</span>
          </div>
          <div class="c-row-sub">${escapeHtml(flagText)}</div>
        </div>
        <span class="c-row-badge badge-l${lvl}">LVL ${lvl}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.country-row').forEach(row => {
    row.addEventListener('click', () => selectCountry(row.dataset.iso));
  });
}

function renderFeedList() {
  const container = document.getElementById('leftTabFeed');
  if (state.recentEvents.length === 0) {
    container.innerHTML = `<div style="padding:16px;color:var(--text-2);font-size:12px;">No wording shifts recorded yet.</div>`;
    return;
  }

  container.innerHTML = state.recentEvents.map(ev => {
    const lvl = ev.new_level || 4;
    const flags = (ev.redFlags || []).map(f => `<span class="red-flag-pill">🚩 ${escapeHtml(f)}</span>`).join('');
    return `
      <div class="event-card" style="cursor:pointer" data-iso="${ev.iso2}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:12.5px;color:#fff;">${escapeHtml(ev.country_name)} (${ev.iso2})</strong>
          <span class="c-row-badge badge-l${lvl}">L${ev.old_level || 1} ➔ L${lvl}</span>
        </div>
        <div style="font-size:11px;color:var(--accent);font-weight:600;">${escapeHtml(ev.source_name)}</div>
        <div style="font-size:11.5px;color:var(--text-1);line-height:1.4;">${escapeHtml(ev.ai_summary)}</div>
        ${flags ? `<div class="sc-flags">${flags}</div>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => selectCountry(card.dataset.iso));
  });
}

async function selectCountry(iso2) {
  state.selectedIso2 = iso2;
  renderCountriesList();
  updateMapColors();

  let payload;
  try {
    const res = await fetch(`/api/country/${iso2}`);
    if (!res.ok) throw new Error('Static fallback');
    payload = await res.json();
  } catch (_) {
    if (!state.staticDetailsCache) {
      const r = await fetch('./data/countries_details.json');
      state.staticDetailsCache = await r.json();
    }
    payload = state.staticDetailsCache[iso2];
  }
  if (!payload) return;
  const { country, sources, events } = payload;

  document.getElementById('dossierEmptyState').classList.add('hidden');
  document.getElementById('dossierContent').classList.remove('hidden');

  document.getElementById('dossierIso').textContent = `${country.iso2} / ${country.iso3 || ''}`;
  document.getElementById('dossierRegion').textContent = country.region || 'Global';
  document.getElementById('dossierCountryName').textContent = country.name;

  updateWatchButtonUI();

  const lvl = country.overall_level || 1;
  const banner = document.getElementById('dossierLevelBanner');
  banner.className = `dossier-level-banner l${lvl}`;
  document.getElementById('dossierLevelNum').textContent = `LEVEL ${lvl}`;
  document.getElementById('dossierLevelText').textContent = LEVEL_LABELS[lvl];
  document.getElementById('dossierResonanceBadge').textContent =
    country.resonance_count > 0 ? `${country.resonance_count} Agencies @ L4+` : `${sources.length} Sources Active`;

  document.getElementById('dossierExecSummary').textContent = country.ai_executive_summary || '';
  document.getElementById('dossierSourceCount').textContent = `${sources.length} Official Sources`;

  // Render Consolidated Status by Each Source Separately
  const sourcesContainer = document.getElementById('dossierSourcesList');
  const SOURCE_ICONS = {
    'us_state_dept': '🇺🇸',
    'us_embassy_alert': '🏛',
    'uk_fcdo': '🇬🇧',
    'il_nsc': '🇮🇱',
    'ca_global_affairs': '🇨🇦',
    'de_auswaertiges_amt': '🇩🇪',
    'aviation_safeairspace': '✈️',
    'nga_maritime': '⚓️',
    'un_reliefweb': '🌐'
  };

  sourcesContainer.innerHTML = sources.map(s => {
    const sLvl = s.normalized_level || 1;
    const icon = SOURCE_ICONS[s.source_id] || '📡';
    const flagsHtml = (s.redFlags || []).map(f => `<span class="red-flag-pill">🚩 ${escapeHtml(f)}</span>`).join('');
    const dateFormatted = s.published_at ? new Date(s.published_at).toUTCString().slice(0, 16) : 'Active';

    return `
      <div class="source-card l${sLvl}">
        <div class="sc-top">
          <span class="sc-agency">${icon} ${escapeHtml(s.source_name)}</span>
          <span class="c-row-badge badge-l${sLvl}">LEVEL ${sLvl}</span>
        </div>
        <div class="sc-raw-level">${escapeHtml(s.raw_level)}</div>
        <div class="sc-summary">${escapeHtml(s.summary)}</div>
        ${flagsHtml ? `<div class="sc-flags">${flagsHtml}</div>` : ''}
        <div class="sc-footer">
          <span>Updated: ${escapeHtml(dateFormatted)}</span>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="sc-link">Official Source ↗</a>
        </div>
      </div>
    `;
  }).join('');

  // Render Wording Diff & Escalation Timeline
  const eventsContainer = document.getElementById('dossierEventsList');
  if (!events || events.length === 0) {
    eventsContainer.innerHTML = `
      <div class="event-card">
        <div style="font-size:11.5px;color:var(--text-2);">
          No recent Red/Black Flag wording shifts logged for ${escapeHtml(country.name)}. Use <strong>⚡ Simulate Crisis Diff</strong> in the top bar to test a live diplomatic wording change on this country.
        </div>
      </div>
    `;
  } else {
    eventsContainer.innerHTML = events.map(ev => {
      const eLvl = ev.new_level || 4;
      const flagsHtml = (ev.redFlags || []).map(f => `<span class="red-flag-pill">🚩 ${escapeHtml(f)}</span>`).join('');
      return `
        <div class="event-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:12px;color:var(--accent)">${escapeHtml(ev.source_name)}</strong>
            <span class="c-row-badge badge-l${eLvl}">L${ev.old_level || 1} ➔ L${eLvl} (${ev.new_level >= 4 ? '📲 TG SENT' : 'SILENT'})</span>
          </div>
          <div style="font-size:12px;font-weight:700;color:#fff;">${escapeHtml(ev.title)}</div>
          <div style="font-size:11.5px;color:var(--text-1);line-height:1.45;">🧠 <strong>AI Brief:</strong> ${escapeHtml(ev.ai_summary)}</div>
          ${flagsHtml ? `<div class="sc-flags">${flagsHtml}</div>` : ''}
          ${ev.diff_before ? `<div class="diff-box diff-removed">➖ BEFORE: ${escapeHtml(ev.diff_before.slice(0, 220))}</div>` : ''}
          ${ev.diff_after ? `<div class="diff-box diff-added">➕ AFTER: ${escapeHtml(ev.diff_after.slice(0, 280))}</div>` : ''}
        </div>
      `;
    }).join('');
  }
}

function updateWatchButtonUI() {
  const btn = document.getElementById('btnToggleWatchCountry');
  if (!state.selectedIso2) return;
  const isWatched = state.watchedCountries.has(state.selectedIso2);
  btn.classList.toggle('watched', isWatched);
  btn.textContent = isWatched ? '⭐ Watched in Telegram' : '☆ Add to Telegram Watchlist';
}

function populateSimulatorSelect() {
  const sel = document.getElementById('simCountrySelect');
  const priority = ['TW', 'IL', 'UA', 'LB', 'IR', 'RS', 'KR', 'PL', 'MD', 'GE', 'AM', 'TR', 'EG', 'JO', 'SA'];
  const sorted = [...state.countries].sort((a, b) => {
    const ia = priority.indexOf(a.iso2);
    const ib = priority.indexOf(b.iso2);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  sel.innerHTML = sorted.map(c =>
    `<option value="${c.iso2}">${escapeHtml(c.name)} (${c.iso2}) — Current: Level ${c.overall_level}</option>`
  ).join('');
}

async function runCrisisSimulation() {
  const btn = document.getElementById('btnRunSimulation');
  const iso2 = document.getElementById('simCountrySelect').value;
  const scenario = document.getElementById('simScenarioSelect').value;

  btn.disabled = true;
  btn.textContent = '⏳ Running Diff + AI Analyst + Telegram Alert...';

  try {
    let data = null;
    try {
      const res = await fetch('/api/simulate-red-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iso2, scenario })
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        data = await res.json();
      }
    } catch {
      // Static cloud mode fallback
    }

    if (!data) {
      // Client-side interactive simulation when hosted statically
      const c = state.countriesByIso2[iso2];
      const oldLvl = c ? c.overall_level : 2;
      const newLvl = scenario === 'ordered_departure' ? 5 : 4;
      const flags = scenario === 'ordered_departure'
        ? ['Ordered Departure (Non-Emergency Embassy Staff)', 'Leave Immediately (Commercial Means)', 'Consular Operations Suspended']
        : scenario === 'airspace_czib'
          ? ['Airspace Risk / Conflict Zone Bulletin (CZIB)', 'Leave Immediately (Commercial Means)']
          : ['Authorized Departure (Voluntary Staff/Family Exit)', 'Shelter in Place / Bunker Readiness Alert'];
      const simSummary = scenario === 'ordered_departure'
        ? `[gpt-4.1-mini] CRITICAL ESCALATION: U.S. Embassy in ${c?.name || iso2} shifted from routine guidance to mandatory Ordered Departure of non-emergency personnel and urged citizens to depart immediately via commercial flights.`
        : `[gpt-4.1-mini] HIGH ESCALATION: Diplomatic security posture upgraded for ${c?.name || iso2} with pre-evacuation indicators (${flags[0]}).`;

      if (c) {
        c.overall_level = newLvl;
        c.has_red_flag = 1;
        c.last_escalation_at = new Date().toISOString();
      }
      const ev = {
        iso2,
        country_name: c?.name || iso2,
        source_id: 'us_embassy_alert',
        source_name: 'U.S. Embassy Local Security Alerts',
        old_level: oldLvl,
        new_level: newLvl,
        redFlags: flags,
        title: `Security Alert: U.S. Embassy ${c?.name || iso2} — ${scenario === 'ordered_departure' ? 'Ordered Departure & Commercial Exit' : 'Authorized Departure'}`,
        diff_before: 'Normal Embassy operations continue. Exercise increased caution due to regional tensions.',
        diff_after: 'Ordered Departure authorized for non-emergency U.S. government employees. U.S. citizens should depart immediately while commercial flight options remain available.',
        ai_summary: simSummary,
        detected_at: new Date().toISOString()
      };
      state.recentEvents.unshift(ev);
      if (state.staticDetailsCache && state.staticDetailsCache[iso2]) {
        state.staticDetailsCache[iso2].country.overall_level = newLvl;
        state.staticDetailsCache[iso2].events.unshift(ev);
      }

      data = {
        previewTelegramHtml: `<b>${newLvl === 5 ? '⚫️' : '🔴'} GEOAlerts | LEVEL ${newLvl} CRITICAL ESCALATION</b>\n\n<b>Country:</b> #${iso2} <b>${escapeHtml(c?.name || iso2)}</b>\n<b>Source:</b> U.S. Embassy Local Security Alerts\n<b>Level Shift:</b> Level ${oldLvl} ➡️ <b>Level ${newLvl}</b>\n\n<b>🚩 Red Flags Detected:</b>\n${flags.map(f => `  • 🚩 <b>${escapeHtml(f)}</b>`).join('\n')}\n\n<b>🧠 AI Intelligence Brief:</b>\n${escapeHtml(simSummary)}`
      };
      renderStatsAndCounts();
      renderCountriesList();
      renderEventsFeed();
      updateMapColors();
      renderRadarPulses();
    } else {
      await loadOverviewData();
    }

    const previewBox = document.getElementById('simResultBox');
    const previewCard = document.getElementById('simTelegramPreview');
    previewBox.classList.remove('hidden');
    previewCard.innerHTML = data.previewTelegramHtml || 'Simulated successfully.';

    setMapMode('radar');
    await selectCountry(iso2);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Inject Wording Change & Run AI + Telegram Alert';
  }
}

async function loadTelegramSettings() {
  try {
    const res = await fetch('/api/telegram/settings');
    if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
      const data = await res.json();
      if (data.subscribers && data.subscribers.length > 0) {
        const sub = data.subscribers[0];
        state.tgChatId = sub.chat_id;
        state.tgMode = sub.mode || 'all';
        state.watchedCountries = new Set(sub.selectedCountries || []);
        document.getElementById('tgChatIdInput').value = sub.chat_id === 'admin_profile' ? '' : sub.chat_id;
        document.querySelectorAll('input[name="tgMode"]').forEach(r => {
          r.checked = r.value === state.tgMode;
        });
        return;
      }
    }
  } catch {
    // Fallback to localStorage in static mode
  }
  const saved = localStorage.getItem('geoalerts_tg_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.tgChatId = parsed.chatId || 'admin_profile';
      state.tgMode = parsed.mode || 'all';
      state.watchedCountries = new Set(parsed.selectedCountries || ['UA', 'IL', 'TW', 'LB', 'IR']);
    } catch {}
  }
}

function renderTelegramModalTags() {
  const container = document.getElementById('tgSelectedTags');
  const quickIsoList = ['UA', 'IL', 'PS', 'LB', 'IR', 'TW', 'RS', 'XK', 'PL', 'LT', 'LV', 'EE', 'MD', 'GE', 'AM', 'AZ', 'TR', 'EG', 'JO', 'SA', 'AE', 'KP', 'KR', 'PH', 'VE'];

  container.innerHTML = quickIsoList.map(iso2 => {
    const c = state.countriesByIso2[iso2];
    const name = c ? c.name : iso2;
    const isAct = state.watchedCountries.has(iso2);
    return `<span class="country-tag ${isAct ? 'active' : ''}" data-iso="${iso2}">${isAct ? '✅ ' : ''}${escapeHtml(name)} (${iso2})</span>`;
  }).join('');

  container.querySelectorAll('.country-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const iso = tag.dataset.iso;
      if (state.watchedCountries.has(iso)) state.watchedCountries.delete(iso);
      else state.watchedCountries.add(iso);
      renderTelegramModalTags();
      updateWatchButtonUI();
    });
  });
}

async function saveTelegramSettings() {
  const selectedMode = document.querySelector('input[name="tgMode"]:checked')?.value || 'all';
  const chatIdInput = document.getElementById('tgChatIdInput').value.trim() || state.tgChatId || 'admin_profile';
  state.tgMode = selectedMode;
  state.tgChatId = chatIdInput;

  await persistTelegramSettingsQuietly();
  document.getElementById('modalTelegram').classList.add('hidden');
}

async function persistTelegramSettingsQuietly() {
  const payload = {
    chatId: state.tgChatId,
    mode: state.tgMode,
    selectedCountries: [...state.watchedCountries]
  };
  localStorage.setItem('geoalerts_tg_settings', JSON.stringify(payload));
  try {
    await fetch('/api/telegram/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // Saved in localStorage in static mode
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
