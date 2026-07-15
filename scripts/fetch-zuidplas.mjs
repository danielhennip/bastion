// Haalt de agenda/inhoud van de Zuidplas-raadsvergadering op voor BASTION,
// via bronnen die NIET achter de Cloudflare-botblokkade van Notubiz zitten.
//
// Notubiz zelf (zuidplas.notubiz.nl) blokkeert alle geautomatiseerde toegang
// (getest: HTTP 403 "you have been blocked", ook met een echte browser).
// Maar de gemeentesite zuidplas.nl publiceert dezelfde vergaderingen in
// gewone HTML op een ander domein, en het Internet Archive (web.archive.org)
// bewaart snapshots. Beide zijn wél bereikbaar vanaf een GitHub-runner.
//
// De agent probeert een reeks bronnen, haalt agenda-achtige tekst eruit, en
// schrijft de beste vondst naar data/zuidplas.json (+ debug). Zo krijgt ook
// een AI de vergaderinhoud binnen zonder de beveiliging van Notubiz te raken.

import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'node:fs/promises';

const MEETING_ID = process.env.ZUIDPLAS_MEETING_ID || '1391079';
const NOTUBIZ_URL = `https://zuidplas.notubiz.nl/vergadering/${MEETING_ID}`;
const OUT_DIR = 'data';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Bronnen op bereikbare hosts (zuidplas.nl + web.archive.org).
const SOURCES = [
  { label: 'zuidplas-agenda-index',   url: 'https://www.zuidplas.nl/agenda-gemeenteraad' },
  { label: 'zuidplas-vergaderingen',  url: 'https://www.zuidplas.nl/vergaderingen-gemeenteraad' },
  { label: 'zuidplas-besluitenlijst', url: 'https://www.zuidplas.nl/besluitenlijsten-gemeenteraad' },
  { label: 'zuidplas-14-juli-2026',   url: 'https://www.zuidplas.nl/raadsvergadering-14-juli-2026' },
  { label: 'zuidplas-6-juli-2026',    url: 'https://www.zuidplas.nl/raadsvergadering-6-juli-2026' },
  { label: 'wayback-notubiz',         url: `https://web.archive.org/web/2id_/${NOTUBIZ_URL}` },
];

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, finalUrl: r.url, text };
}

function extractAgenda($) {
  const items = new Set();
  const selectors = [
    '[class*="agenda" i] li',
    '[class*="agenda" i] a',
    '.agendapunt, [class*="agendapunt" i]',
    'main ol li',
    'main ul li',
    'article li',
  ];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length > 3 && t.length < 220) items.add(t);
    });
  }
  return Array.from(items).slice(0, 80);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const attempts = [];
  let best = null;

  for (const src of SOURCES) {
    try {
      const res = await fetchHtml(src.url);
      const blocked = /you have been blocked|attention required|just a moment/i.test(res.text.slice(0, 3000));
      let title = null, agenda = [], textPreview = '';
      if (res.ok && !blocked) {
        const $ = cheerio.load(res.text);
        title = ($('h1').first().text() || $('title').text() || '').replace(/\s+/g, ' ').trim();
        agenda = extractAgenda($);
        textPreview = $('main').text().replace(/\s+/g, ' ').trim().slice(0, 1200)
          || $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1200);
      }
      const attempt = {
        label: src.label, url: src.url, status: res.status, finalUrl: res.finalUrl,
        blocked, title, agendaCount: agenda.length, textPreview,
      };
      attempts.push({ ...attempt, agenda });
      if (!best && res.ok && !blocked && (agenda.length > 0 || textPreview.length > 200)) {
        best = { source: src.label, url: src.finalUrl || src.url, title, agenda, textPreview };
      }
    } catch (e) {
      attempts.push({ label: src.label, url: src.url, error: String((e && e.message) || e) });
    }
  }

  const result = {
    fetchedAt: new Date().toISOString(),
    meetingId: MEETING_ID,
    notubizUrl: NOTUBIZ_URL,
    dataSource: best ? best.source : 'none',
    title: best ? best.title : null,
    agenda: best ? best.agenda : [],
    textPreview: best ? best.textPreview : null,
    note: best
      ? 'Data via een bereikbare bron (zuidplas.nl / web.archive.org). Notubiz zelf blokkeert automatische toegang.'
      : 'Geen bereikbare bron leverde bruikbare inhoud; Notubiz blokkeert automatische toegang.',
  };

  await writeFile(`${OUT_DIR}/zuidplas.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${OUT_DIR}/zuidplas-debug.json`, JSON.stringify({ fetchedAt: result.fetchedAt, attempts }, null, 2) + '\n');

  console.log(`Klaar. dataSource=${result.dataSource} title=${JSON.stringify(result.title)} agendapunten=${result.agenda.length}`);
  attempts.forEach(a => console.log(`  ${a.label}: status=${a.status ?? a.error} blocked=${a.blocked} agenda=${a.agendaCount ?? 0}`));
}

main().catch(err => { console.error(err); process.exitCode = 1; });
