/* ═══════════════════════════════════════════
   BASTION — App Logic
   Data: RSS feeds · Open-Meteo · GDELT · Static
═══════════════════════════════════════════ */

'use strict';

// ── Config ──────────────────────────────────
// corsproxy.io: gratis CORS proxy, geen key nodig
const CORS_PROXY = 'https://corsproxy.io/?';

const WEATHER_LAT = 52.09; // Utrecht (pas aan naar jouw stad)
const WEATHER_LON = 5.12;

// Gemeente Zuidplas — Notubiz raadsvergadering
// Pas ZUIDPLAS_MEETING_URL aan zodra er een nieuwe vergadering-ID is.
const ZUIDPLAS_MEETING_URL = 'https://zuidplas.notubiz.nl/vergadering/1391079';
// Handmatig ingevuld bestand krijgt voorrang op de (vaak geblokkeerde)
// automatische scrape. Vul data/zuidplas-manual.json met { "title": "...",
// "agenda": ["punt 1", "punt 2", ...] } om de agenda zelf te tonen.
const ZUIDPLAS_AGENDA_SOURCES = ['data/zuidplas-manual.json', 'data/zuidplas.json'];

const FEEDS = {
  nos:       'https://feeds.nos.nl/nosnieuwsalgemeen',
  bbc:       'https://feeds.bbci.co.uk/news/world/rss.xml',
  reuters:   'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best',
  politiek:  'https://feeds.nos.nl/nosnieuwspolitiek',
  veiligheid:'https://feeds.nos.nl/nosnieuwsbinnenland',
  dw:        'https://rss.dw.com/rdf/rss-en-all',
  aljazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  conflict:  'https://www.aljazeera.com/xml/rss/all.xml',
};

// ── Conflict dataset (statisch, handmatig bijgewerkt) ──
const CONFLICTS = [
  {
    name: 'Rusland–Oekraïne',
    location: 'Oost-Europa',
    severity: 'critical',
    tags: ['militair', 'NAVO', 'EU'],
    stat: 'Dag 851+',
    desc: 'Grootschalige conventionele oorlog. NAVO-lid Polen grenst direct.'
  },
  {
    name: 'Gaza / Israël–Hamas',
    location: 'Midden-Oosten',
    severity: 'critical',
    tags: ['militair', 'humanitair'],
    stat: 'Dag 600+',
    desc: 'Stedelijke gevechten, humanitaire crisis, regionale escalatierisico\'s.'
  },
  {
    name: 'Sudan Burgeroorlog',
    location: 'Noordoost-Afrika',
    severity: 'high',
    tags: ['militair', 'humanitair'],
    stat: '>150k doden',
    desc: 'SAF vs RSF. Grootste ontheemdingencrisis ter wereld.'
  },
  {
    name: 'Myanmar',
    location: 'Zuidoost-Azië',
    severity: 'high',
    tags: ['militair', 'politiek'],
    stat: 'Dag 1.200+',
    desc: 'Junta vs verzetsgroepen. VN spreekt van burgeroorlog.'
  },
  {
    name: 'Haïti',
    location: 'Caribisch gebied',
    severity: 'high',
    tags: ['politiek', 'humanitair'],
    stat: 'Staatsinstorting',
    desc: 'Bendecontrole over Port-au-Prince. Keniaanse politiemissie actief.'
  },
  {
    name: 'Sahel (Mali/Burkina/Niger)',
    location: 'West-Afrika',
    severity: 'high',
    tags: ['militair', 'politiek'],
    stat: '3 junta\'s',
    desc: 'Jihadistisch geweld + pro-Russische juntas. Migratie-impact op EU.'
  },
  {
    name: 'Ethiopië (Amhara)',
    location: 'Oost-Afrika',
    severity: 'medium',
    tags: ['militair'],
    stat: 'Lopend',
    desc: 'Hervatting conflict na Tigray-akkoord. Amhara-regio onder druk.'
  },
  {
    name: 'Taiwan-straat',
    location: 'Oost-Azië',
    severity: 'medium',
    tags: ['politiek', 'economisch'],
    stat: 'Hoog gespannen',
    desc: 'Chinese militaire druk. Kritieke zeewegen voor handel.'
  },
];

// ── Dreigingsniveaus NCTV ──
const THREAT_INFO = {
  label: 'SUBSTANTIEEL',
  css: 'threat-substantial',
  detail: 'Niveau 4 van 5 — Kans op aanslag is reëel (NCTV, 2026)'
};

// ═══════════════════════════════════════════
// KLOK
// ═══════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const days = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
  const months = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

  document.getElementById('clock').textContent =
    now.toLocaleTimeString('nl-NL', { hour12: false });

  document.getElementById('date').textContent =
    `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');

    // lazy-load tab content
    if (tab === 'nieuws')     loadNieuwsTab();
    if (tab === 'conflict')   loadConflictTab();
    if (tab === 'nl-politiek') loadPolitiekTab();
    if (tab === 'zuidplas')   loadZuidplasTab();
  });
});

// ═══════════════════════════════════════════
// RSS FETCH — corsproxy.io + DOMParser
// ═══════════════════════════════════════════
const feedCache = {};

function parseRSS(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const items = Array.from(doc.querySelectorAll('item, entry'));
  return items.map(el => {
    const txt = t => el.querySelector(t)?.textContent?.trim() || '';
    const attr = (t, a) => el.querySelector(t)?.getAttribute(a) || '';
    return {
      title:      txt('title'),
      link:       txt('link') || attr('link', 'href') || txt('guid'),
      pubDate:    txt('pubDate') || txt('published') || txt('updated'),
      categories: Array.from(el.querySelectorAll('category')).map(c => c.textContent.trim()),
    };
  }).filter(i => i.title && i.link);
}

async function fetchFeed(key, url) {
  if (feedCache[key]) return feedCache[key];
  try {
    const r = await fetch(CORS_PROXY + encodeURIComponent(url), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    const items = parseRSS(xml);
    if (!items.length) throw new Error('Geen items in feed');
    feedCache[key] = items;
    return items;
  } catch(e) {
    console.warn(`Feed ${key} mislukt:`, e.message);
    return null;
  }
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 1)   return 'Nu';
  if (diff < 60)  return `${diff}m geleden`;
  if (diff < 1440) return `${Math.floor(diff/60)}u geleden`;
  return `${Math.floor(diff/1440)}d geleden`;
}

function renderNewsItem(item, source) {
  const a = document.createElement('a');
  a.className = 'news-item';
  a.href = item.link || '#';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  const ago = item.pubDate ? timeAgo(item.pubDate) : '';
  const cat = item.categories?.[0] || '';

  a.innerHTML = `
    <div class="news-title">${escHtml(item.title || 'Geen titel')}</div>
    <div class="news-meta">
      <span class="source">${escHtml(source)}</span>
      ${ago ? `<span class="sep">·</span><span>${escHtml(ago)}</span>` : ''}
      ${cat ? `<span class="sep">·</span><span class="news-category">${escHtml(cat.toUpperCase())}</span>` : ''}
    </div>
  `;
  return a;
}

function escHtml(str) {
  return String(str)
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#039;/g,"'")
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadFeedInto(containerId, feedKey, feedUrl, source, limit = 8) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const items = await fetchFeed(feedKey, feedUrl);
  el.innerHTML = '';

  if (!items || !items.length) {
    el.innerHTML = `<div class="error-item">⚠ Feed tijdelijk niet beschikbaar</div>`;
    return;
  }

  items.slice(0, limit).forEach(item => {
    el.appendChild(renderNewsItem(item, source));
  });
}

// Tries multiple [key, url, source] pairs until one works
async function loadFeedIntoFallback(containerId, sources, limit = 8) {
  const el = document.getElementById(containerId);
  if (!el) return;

  for (const [key, url, source] of sources) {
    const items = await fetchFeed(key, url);
    if (items && items.length) {
      el.innerHTML = '';
      items.slice(0, limit).forEach(item => el.appendChild(renderNewsItem(item, source)));
      return;
    }
  }
  el.innerHTML = `<div class="error-item">⚠ Feeds tijdelijk niet beschikbaar</div>`;
}

// ═══════════════════════════════════════════
// CONFLICT LIST
// ═══════════════════════════════════════════
function renderConflictList(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';

  CONFLICTS.forEach(c => {
    const div = document.createElement('div');
    div.className = 'conflict-item';

    const tags = c.tags.map(t =>
      `<span class="conflict-tag tag-${t.toLowerCase().replace(/\s+/g,'-')}">${t.toUpperCase()}</span>`
    ).join('');

    div.innerHTML = `
      <div class="conflict-severity sev-${c.severity}"></div>
      <div class="conflict-body">
        <div class="conflict-name">${escHtml(c.name)}</div>
        <div class="conflict-location">📍 ${escHtml(c.location)}</div>
        <div class="conflict-tags">${tags}</div>
      </div>
      <div class="conflict-stat">${escHtml(c.stat)}</div>
    `;
    el.appendChild(div);
  });

  document.getElementById('conflict-count').textContent = CONFLICTS.filter(c => c.severity === 'critical' || c.severity === 'high').length + ' actief';
}

// ═══════════════════════════════════════════
// WEER — Open-Meteo (gratis, geen API key)
// ═══════════════════════════════════════════
const WMO_ICONS = {
  0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️',
  45:'🌫️', 48:'🌫️',
  51:'🌦️', 53:'🌦️', 55:'🌧️',
  61:'🌧️', 63:'🌧️', 65:'🌧️',
  71:'❄️', 73:'❄️', 75:'❄️',
  80:'🌦️', 81:'🌧️', 82:'⛈️',
  95:'⛈️', 96:'⛈️', 99:'⛈️'
};

const WMO_DESC = {
  0:'Helder', 1:'Overwegend helder', 2:'Wisselend bewolkt', 3:'Bewolkt',
  45:'Mist', 48:'Mist',
  51:'Lichte motregen', 53:'Motregen', 55:'Zware motregen',
  61:'Lichte regen', 63:'Regen', 65:'Zware regen',
  71:'Lichte sneeuw', 73:'Sneeuw', 75:'Zware sneeuw',
  80:'Regenbuien', 81:'Zware buien', 82:'Zeer zware buien',
  95:'Onweer', 96:'Onweer met hagel', 99:'Zwaar onweer'
};

async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max&hourly=temperature_2m,weathercode&current_weather=true&timezone=Europe%2FAmsterdam&forecast_days=3`;
    const r = await fetch(url);
    const d = await r.json();

    const cw = d.current_weather;
    const statusEl = document.getElementById('weather-val');
    if (statusEl) {
      const icon = WMO_ICONS[cw.weathercode] || '🌡️';
      statusEl.textContent = `${icon} ${Math.round(cw.temperature)}°C`;
    }

    const detailEl = document.getElementById('weather-detail');
    if (!detailEl) return;
    detailEl.innerHTML = '';
    detailEl.className = 'weather-grid';

    const dayNames = ['Vandaag','Morgen','Overmorgen'];
    const daily = d.daily;

    for (let i = 0; i < 3; i++) {
      const wc = daily.weathercode[i];
      const icon = WMO_ICONS[wc] || '🌡️';
      const desc = WMO_DESC[wc] || '';
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const wind = Math.round(daily.windspeed_10m_max[i]);

      const day = document.createElement('div');
      day.className = 'weather-day';
      day.innerHTML = `
        <div class="weather-day-name">${dayNames[i]}</div>
        <div class="weather-icon">${icon}</div>
        <div class="weather-temp">${max}°</div>
        <div class="weather-detail-row">
          <span class="weather-sub">${min}°</span>
          <span class="weather-sub" style="margin-left:4px">· 💨${wind}km/h</span>
        </div>
        <div class="weather-desc">${desc}</div>
      `;
      detailEl.appendChild(day);
    }
  } catch(e) {
    console.warn('Weer ophalen mislukt:', e);
    const el = document.getElementById('weather-val');
    if (el) el.textContent = '— niet beschikbaar';
  }
}

// ═══════════════════════════════════════════
// WISSELKOERSEN — exchangerate.host (gratis)
// ═══════════════════════════════════════════
async function loadFX() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/EUR');
    const d = await r.json();
    const rates = d.rates;
    const usd = document.getElementById('fx-eurusd');
    if (usd && rates?.USD) {
      usd.textContent = `$${rates.USD.toFixed(4)}`;
    }
  } catch(e) {
    const el = document.getElementById('fx-eurusd');
    if (el) el.textContent = '—';
  }
}

// ═══════════════════════════════════════════
// TABS: Nieuws
// ═══════════════════════════════════════════
let nieuwsLoaded = false;
async function loadNieuwsTab() {
  if (nieuwsLoaded) return;
  nieuwsLoaded = true;
  await Promise.all([
    loadFeedInto('feed-nos-full',     'nos',       FEEDS.nos,       'NOS',             15),
    loadFeedInto('feed-bbc-full',     'bbc',       FEEDS.bbc,       'BBC World',       15),
    loadFeedInto('feed-reuters-full', 'aljazeera', FEEDS.aljazeera, 'Al Jazeera',      15),
  ]);
}

// ═══════════════════════════════════════════
// TABS: Conflict
// ═══════════════════════════════════════════
let conflictTabLoaded = false;
async function loadConflictTab() {
  if (conflictTabLoaded) return;
  conflictTabLoaded = true;
  renderConflictList('conflict-list-full');
  await loadFeedInto('feed-conflict-news', 'aljazeera', FEEDS.aljazeera, 'Al Jazeera', 15);
}

// ═══════════════════════════════════════════
// TABS: NL Politiek
// ═══════════════════════════════════════════
let politiekLoaded = false;
async function loadPolitiekTab() {
  if (politiekLoaded) return;
  politiekLoaded = true;
  await Promise.all([
    loadFeedInto('feed-politiek',    'politiek',   FEEDS.politiek,    'NOS Politiek',   15),
    loadFeedInto('feed-kamerstukken','dw',         FEEDS.dw,          'Deutsche Welle', 15),
    loadFeedInto('feed-veiligheid',  'veiligheid', FEEDS.veiligheid,  'NOS Binnenland', 15),
  ]);
}

// ═══════════════════════════════════════════
// TABS: Gemeente Zuidplas
// ═══════════════════════════════════════════
let zuidplasLoaded = false;
async function loadZuidplasTab() {
  if (zuidplasLoaded) return;
  zuidplasLoaded = true;

  // Livestream pas laden zodra het tabblad daadwerkelijk bekeken wordt
  const frame = document.getElementById('zuidplas-frame');
  if (frame && !frame.src) frame.src = ZUIDPLAS_MEETING_URL;

  await Promise.all([loadZuidplasAgenda(), loadZuidplasLive(), loadZuidplasNotes()]);

  // Live transcript + AI-aantekeningen periodiek verversen zolang het tabblad open is.
  if (!window._zuidplasLiveTimer) {
    window._zuidplasLiveTimer = setInterval(loadZuidplasLive, 20000);
    window._zuidplasNotesTimer = setInterval(loadZuidplasNotes, 30000);
  }
}

async function loadZuidplasLive() {
  const el = document.getElementById('zuidplas-live');
  const badge = document.getElementById('zuidplas-live-badge');
  if (!el) return;

  // LIVE alleen tonen als de brug recent (< 5 min) iets schreef; het bestand
  // zelf blijft immers staan na afloop van een vergadering.
  let fresh = false;
  try {
    const rs = await fetch('data/zuidplas-live-status.json', { cache: 'no-store' });
    if (rs.ok) {
      const s = await rs.json();
      fresh = s.updatedAt && (Date.now() - new Date(s.updatedAt).getTime()) < 5 * 60 * 1000 && s.running !== false;
    }
  } catch (e) { /* geen statusbestand — dan OFFLINE */ }

  try {
    const r = await fetch('data/zuidplas-live.md', { cache: 'no-store' });
    if (!r.ok) throw new Error('geen transcript');
    const md = (await r.text()).trim();
    if (!md) throw new Error('leeg');

    // Toon de laatste regels (nieuwste onderaan het bestand).
    const lines = md.split('\n').filter(l => l.trim());
    const recent = lines.slice(-40);
    el.innerHTML = recent.map(l => `<div class="transcript-line">${escHtml(l)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  } catch (e) { /* transcript (nog) leeg — melding in HTML blijft staan */ }

  if (badge) {
    badge.textContent = fresh ? 'LIVE' : 'OFFLINE';
    badge.classList.toggle('critical', fresh);
  }
}

// AI-aantekeningen: door Claude gevuld (skill zuidplas-meekijken) in
// data/zuidplas-notes.md. Mini-markdownweergave, geen externe libs.
async function loadZuidplasNotes() {
  const el = document.getElementById('zuidplas-notes');
  const badge = document.getElementById('zuidplas-notes-badge');
  if (!el) return;
  try {
    const r = await fetch('data/zuidplas-notes.md', { cache: 'no-store' });
    if (!r.ok) throw new Error('geen notities');
    const md = await r.text();

    const updated = (md.match(/<!--\s*bijgewerkt:\s*([^>]*?)\s*-->/) || [])[1];
    const body = md.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!body) throw new Error('leeg');

    el.innerHTML = body.split('\n').map(line => {
      const t = line.trim();
      if (!t) return '';
      const safe = escHtml(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      if (t.startsWith('### ')) return `<div class="notes-h3">${safe.slice(4)}</div>`;
      if (t.startsWith('## '))  return `<div class="notes-h2">${safe.slice(3)}</div>`;
      if (t.startsWith('# '))   return `<div class="notes-h1">${safe.slice(2)}</div>`;
      if (t.startsWith('- '))   return `<div class="notes-li">• ${safe.slice(2)}</div>`;
      return `<div class="notes-p">${safe}</div>`;
    }).join('');

    if (badge) {
      const fresh = updated && updated !== 'nooit' && (Date.now() - new Date(updated).getTime()) < 10 * 60 * 1000;
      badge.textContent = fresh ? 'LIVE' : (updated && updated !== 'nooit' ? timeAgo(updated) : '—');
      badge.classList.toggle('critical', !!fresh);
    }
  } catch (e) {
    if (badge) badge.textContent = '—';
  }
}

async function loadZuidplasAgenda() {
  const el = document.getElementById('zuidplas-agenda');
  const badge = document.getElementById('zuidplas-agenda-updated');
  if (!el) return;

  // Probeer eerst het handmatige bestand, dan de automatische scrape.
  let data = null;
  for (const src of ZUIDPLAS_AGENDA_SOURCES) {
    try {
      const r = await fetch(src, { cache: 'no-store' });
      if (r.ok) { data = await r.json(); break; }
    } catch (e) { /* volgende bron proberen */ }
  }

  el.innerHTML = '';

  if (!data) {
    el.innerHTML = `<div class="error-item">Nog geen agendadata. Vul <code>data/zuidplas-manual.json</code> of open de vergadering hiernaast.</div>`;
    if (badge) badge.textContent = '—';
    return;
  }

  const blocked = data.cloudflareBlocked || data.dataSource === 'blocked';
  if (data.title && !blocked) {
    const title = document.createElement('div');
    title.className = 'news-title';
    title.style.padding = '10px 14px 0';
    title.textContent = data.title;
    el.appendChild(title);
  }

  if (Array.isArray(data.agenda) && data.agenda.length) {
    data.agenda.forEach(item => {
      const div = document.createElement('div');
      div.className = 'news-item';
      const label = typeof item === 'string' ? item : (item.title || item.name || JSON.stringify(item));
      div.innerHTML = `<div class="news-title">${escHtml(label)}</div>`;
      el.appendChild(div);
    });
  } else if (blocked) {
    // Eerlijke melding: de automatische ophaal wordt door Notubiz geblokkeerd.
    el.innerHTML += `<div class="error-item">⚠ Automatische ophaal geblokkeerd door Notubiz (Cloudflare-botbescherming). Bekijk de vergadering via de speler/links hiernaast; agenda kan handmatig in <code>data/zuidplas-manual.json</code>.</div>`;
  } else {
    el.innerHTML += `<div class="error-item">Geen agendapunten gevonden.</div>`;
  }

  // Besluitenlijsten (PDF's) via zuidplas.nl.
  if (Array.isArray(data.besluitenlijsten) && data.besluitenlijsten.length) {
    const hdr = document.createElement('div');
    hdr.className = 'news-title';
    hdr.style.cssText = 'padding:12px 14px 4px;color:var(--text2);font-size:10px;letter-spacing:1px;text-transform:uppercase';
    hdr.textContent = 'Besluitenlijsten';
    el.appendChild(hdr);
    data.besluitenlijsten.forEach(b => {
      const a = document.createElement('a');
      a.className = 'news-item';
      a.href = b.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.innerHTML = `<div class="news-title">📄 ${escHtml(b.label)}</div>`;
      el.appendChild(a);
    });
  }

  if (badge) {
    badge.textContent = data.fetchedAt ? timeAgo(data.fetchedAt) : 'handmatig';
    badge.title = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString('nl-NL') : 'Handmatig ingevuld';
  }
}

// ═══════════════════════════════════════════
// REFRESH ALL
// ═══════════════════════════════════════════
async function refreshAll() {
  Object.keys(feedCache).forEach(k => delete feedCache[k]);
  nieuwsLoaded = false;
  conflictTabLoaded = false;
  politiekLoaded = false;
  zuidplasLoaded = false;
  await initDashboard();
}

// ═══════════════════════════════════════════
// DREIGINGSNIVEAU
// ═══════════════════════════════════════════
function setThreat() {
  const el = document.getElementById('threat-level');
  if (!el) return;
  el.className = 'status-value ' + THREAT_INFO.css;
  el.textContent = THREAT_INFO.label;
  el.title = THREAT_INFO.detail;
}

// ═══════════════════════════════════════════
// UPDATE TIMESTAMP
// ═══════════════════════════════════════════
function setUpdateTime() {
  const now = new Date();
  const t = now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const el = document.getElementById('last-update');
  const fe = document.getElementById('footer-updated');
  if (el) el.textContent = t;
  if (fe) fe.textContent = `Bijgewerkt om ${t}`;
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
async function initDashboard() {
  setThreat();

  // Dashboard tab - parallel
  await Promise.all([
    loadFeedInto('feed-nos',      'nos',       FEEDS.nos,       'NOS',        6),
    loadFeedInto('feed-bbc',      'bbc',       FEEDS.bbc,       'BBC World',  6),
    loadFeedInto('feed-security', 'aljazeera', FEEDS.aljazeera, 'Al Jazeera', 6),
    loadWeather(),
    loadFX(),
  ]);

  renderConflictList('conflict-list');
  setUpdateTime();
}

// Auto-refresh elke 10 minuten
setInterval(() => {
  Object.keys(feedCache).forEach(k => delete feedCache[k]);
  initDashboard();
}, 10 * 60 * 1000);

// Start
initDashboard();
