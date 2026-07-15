// Haalt de agenda, vergaderstukken en besluiten van de Zuidplas-gemeenteraad
// op voor BASTION, via bronnen die NIET achter de Cloudflare-botblokkade van
// Notubiz zitten.
//
// Notubiz (zuidplas.notubiz.nl) blokkeert alle geautomatiseerde toegang
// (getest: HTTP 403 "you have been blocked", ook met een echte browser).
// De gemeentesite zuidplas.nl publiceert dezelfde vergaderingen + besluiten
// in gewone HTML/PDF op een ander domein, en is wél bereikbaar vanaf een
// GitHub-runner. Zo krijgt ook een AI de vergaderinhoud binnen zonder de
// beveiliging van Notubiz te raken.
//
// Schrijft data/zuidplas.json (voor het dashboard) + data/zuidplas-debug.json.

import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'node:fs/promises';

const MEETING_ID = process.env.ZUIDPLAS_MEETING_ID || '1391079';
const NOTUBIZ_URL = `https://zuidplas.notubiz.nl/vergadering/${MEETING_ID}`;
const BASE = 'https://www.zuidplas.nl';
const OUT_DIR = 'data';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Menu/breadcrumb-items die we uit de agenda willen filteren.
const NAV_NOISE = new Set([
  'home', 'in zuidplas', 'actueel', 'nieuws', 'nieuws archief', 'bestuur',
  'gemeenteraad', 'agenda gemeenteraad', 'besluitenlijsten gemeenteraad',
  'organisatie en bestuur', 'contact', 'zoeken', 'menu',
]);

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'nl-NL,nl;q=0.9' },
    redirect: 'follow', signal: AbortSignal.timeout(25000),
  });
  return { status: r.status, ok: r.ok, finalUrl: r.url, text: await r.text() };
}

async function fetchBuffer(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  return { status: r.status, ok: r.ok, buffer: Buffer.from(await r.arrayBuffer()) };
}

function cleanList($, selectors) {
  const items = [];
  const seen = new Set();
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      const key = t.toLowerCase();
      if (t && t.length > 3 && t.length < 240 && !seen.has(key) && !NAV_NOISE.has(key)) {
        seen.add(key); items.push(t);
      }
    });
  }
  return items;
}

// Best-effort PDF-tekst zonder externe binaries: haal tekst-tokens uit de
// PDF-content streams. Werkt voor eenvoudige, niet-gecomprimeerde besluiten-
// lijsten; anders blijft het leeg (geen harde fout).
function pdfTextBestEffort(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let s = m[1] ?? m[2] ?? '';
    s = s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
         .replace(/\\([()\\])/g, '$1')
         .replace(/\)\s*-?\d+\s*\(/g, '');
    if (s.trim()) chunks.push(s);
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const attempts = [];

  // 1. Overzichtspagina's + recente vergaderingen ophalen.
  const pages = [
    { label: 'agenda-index', url: `${BASE}/agenda-gemeenteraad` },
    { label: 'besluitenlijsten', url: `${BASE}/besluitenlijsten-gemeenteraad` },
    { label: 'raadsvergadering-14-juli-2026', url: `${BASE}/raadsvergadering-14-juli-2026` },
    { label: 'raadsvergadering-6-juli-2026', url: `${BASE}/raadsvergadering-6-juli-2026` },
  ];

  let meeting = null;
  const besluitenPdfs = [];

  for (const p of pages) {
    try {
      const res = await fetchText(p.url);
      const blocked = /you have been blocked|attention required/i.test(res.text.slice(0, 3000));
      const $ = cheerio.load(res.text);
      const title = ($('h1').first().text() || $('title').text() || '').replace(/\s+/g, ' ').trim();

      // Verzamel PDF-links (besluitenlijsten / vergaderstukken).
      $('a[href$=".pdf"], a[href*=".pdf?"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const label = $(a).text().replace(/\s+/g, ' ').trim();
        if (href && label) {
          const full = href.startsWith('http') ? href : new URL(href, BASE).toString();
          besluitenPdfs.push({ label, url: full, from: p.label });
        }
      });

      // Neem de eerst gevonden echte vergaderpagina als "meeting".
      if (!meeting && /raadsvergadering/i.test(p.label) && res.ok && !blocked) {
        const agenda = cleanList($, ['main li', 'article li', '.content li', 'main p']).slice(0, 40);
        meeting = { source: p.label, url: res.finalUrl, title, agenda };
      }

      attempts.push({ label: p.label, url: p.url, status: res.status, blocked, title });
    } catch (e) {
      attempts.push({ label: p.label, url: p.url, error: String((e && e.message) || e) });
    }
  }

  // 2. Nieuwste besluitenlijst-PDF ophalen en (best-effort) tekst eruit halen.
  let latestDecisions = null;
  const firstPdf = besluitenPdfs.find(p => /besluitenlijst/i.test(p.label));
  if (firstPdf) {
    try {
      const buf = await fetchBuffer(firstPdf.url);
      if (buf.ok) {
        const text = pdfTextBestEffort(buf.buffer);
        latestDecisions = { label: firstPdf.label, url: firstPdf.url, textPreview: text.slice(0, 3000) };
      }
      attempts.push({ label: 'besluitenlijst-pdf', url: firstPdf.url, status: buf.status });
    } catch (e) {
      attempts.push({ label: 'besluitenlijst-pdf', url: firstPdf.url, error: String((e && e.message) || e) });
    }
  }

  const result = {
    fetchedAt: new Date().toISOString(),
    meetingId: MEETING_ID,
    notubizUrl: NOTUBIZ_URL,
    dataSource: meeting ? meeting.source : (besluitenPdfs.length ? 'besluitenlijsten' : 'none'),
    title: meeting ? meeting.title : 'Gemeenteraad Zuidplas',
    agenda: meeting ? meeting.agenda : [],
    besluitenlijsten: besluitenPdfs.filter(p => /besluitenlijst/i.test(p.label)).slice(0, 15),
    latestDecisions,
    note: 'Inhoud via zuidplas.nl (bereikbaar). De volledige live-agenda en gesproken vergadering staan op Notubiz, dat automatische toegang blokkeert — gebruik daarvoor de live-brug (tools/live-bridge).',
  };

  await writeFile(`${OUT_DIR}/zuidplas.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${OUT_DIR}/zuidplas-debug.json`, JSON.stringify({ fetchedAt: result.fetchedAt, attempts, besluitenPdfs }, null, 2) + '\n');

  console.log(`Klaar. dataSource=${result.dataSource} agendapunten=${result.agenda.length} besluitenlijsten=${result.besluitenlijsten.length} decisions=${!!latestDecisions}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
