// Haalt data over de Notubiz-vergadering van gemeente Zuidplas op voor BASTION.
//
// Achtergrond: de website zuidplas.notubiz.nl zit achter Cloudflare-
// botbescherming. Vanaf een datacenter-IP (zoals een GitHub-runner) wordt
// zowel een kale fetch als een headless browser hard geblokkeerd
// ("Sorry, you have been blocked"). Een echte browser op een thuis-IP komt
// er wél door — daarom werkt de embed in het dashboard voor de gebruiker.
//
// Deze agent probeert daarom twee dingen, en logt eerlijk wat lukt:
//   1. De publieke Notubiz-API (api.notubiz.nl) — die is meestal NIET
//      achter dezelfde botblokkade als de frontend. Beste kans op data.
//   2. De pagina renderen in headless Chromium + screenshot, zodat ook een
//      AI kan zien wat er staat (of dat er een Cloudflare-blok staat).
//
// Schrijft:
//   data/zuidplas.json        → gestructureerde data voor het dashboard
//   data/zuidplas-debug.json  → ruwe vondsten (API-responses, DOM, netwerk)
//   data/zuidplas.png         → screenshot van de gerenderde pagina

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const MEETING_ID = process.env.ZUIDPLAS_MEETING_ID || '1391079';
const MEETING_URL = process.env.ZUIDPLAS_MEETING_URL || `https://zuidplas.notubiz.nl/vergadering/${MEETING_ID}`;
const OUT_DIR = 'data';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── 1. Notubiz publieke API aftasten ─────────────────────────────
// We kennen het exacte schema niet zeker, dus we proberen een reeks
// plausibele endpoints en loggen wat werkt.
const API_CANDIDATES = [
  `https://api.notubiz.nl/events/meeting/${MEETING_ID}?format=json&version=1.10.0`,
  `https://api.notubiz.nl/events/meeting/${MEETING_ID}?format=json`,
  `https://api.notubiz.nl/events/${MEETING_ID}?format=json&version=1.10.0`,
  `https://api.notubiz.nl/gathering/${MEETING_ID}?format=json&version=1.10.0`,
  `https://api.notubiz.nl/meeting/${MEETING_ID}?format=json`,
  `https://api.notubiz.nl/events/meeting/${MEETING_ID}`,
];

async function probeApi() {
  const results = [];
  for (const url of API_CANDIDATES) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' },
        signal: AbortSignal.timeout(15000),
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      results.push({
        url,
        status: r.status,
        contentType: r.headers.get('content-type') || '',
        isJson: !!json,
        length: text.length,
        preview: text.slice(0, 600),
        json: json && typeof json === 'object' ? json : null,
      });
      // Stop bij de eerste bruikbare JSON-hit.
      if (r.ok && json) break;
    } catch (e) {
      results.push({ url, error: String((e && e.message) || e) });
    }
  }
  return results;
}

function agendaFromApiJson(json) {
  // Best-effort: zoek in willekeurige Notubiz-JSON naar agenda-achtige titels.
  const out = [];
  const visit = (node, depth) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, depth + 1)); return; }
    if (typeof node === 'object') {
      const t = node.title || node.name || node.subject || node.description;
      if (typeof t === 'string' && t.trim().length > 3 && t.trim().length < 220) {
        out.push(t.trim());
      }
      Object.values(node).forEach(v => visit(v, depth + 1));
    }
  };
  visit(json, 0);
  return Array.from(new Set(out)).slice(0, 80);
}

// ── 2. Pagina renderen in headless Chromium ─────────────────────
async function renderPage() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'nl-NL',
    viewport: { width: 1440, height: 2200 },
    timezoneId: 'Europe/Amsterdam',
  });

  const networkVideo = new Set();
  context.on('request', req => {
    const u = req.url();
    if (/\.m3u8|\.mpd|mistserver|companywebcast|player\.|vimeo|youtube|stream/i.test(u)) networkVideo.add(u);
  });

  const page = await context.newPage();
  const out = { pageTitle: '', cloudflareBlocked: false, status: 'unknown', extracted: null, networkVideo: [] };

  try {
    const resp = await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    out.status = resp ? `http-${resp.status()}` : 'no-response';
    await page.waitForTimeout(6000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

    out.pageTitle = await page.title().catch(() => '');
    out.cloudflareBlocked = /just a moment|attention required|you have been blocked|cloudflare/i.test(out.pageTitle);

    await page.screenshot({ path: `${OUT_DIR}/zuidplas.png`, fullPage: true }).catch(() => {});

    out.extracted = await page.evaluate(() => {
      const agenda = [];
      const seen = new Set();
      ['[class*="agenda" i] li', '[class*="agenda" i] a', 'ol li', 'ul li a', '[class*="punt" i]'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length > 3 && t.length < 220 && !seen.has(t)) { seen.add(t); agenda.push(t); }
        });
      });
      return {
        title: (document.querySelector('h1,h2')?.textContent || document.title || '').replace(/\s+/g, ' ').trim(),
        agenda: agenda.slice(0, 80),
        iframeSrcs: Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(Boolean),
        bodyTextPreview: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
      };
    });
    out.networkVideo = Array.from(networkVideo).slice(0, 30);
  } catch (e) {
    out.status = 'error';
    out.error = String((e && e.message) || e);
    await page.screenshot({ path: `${OUT_DIR}/zuidplas.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const api = await probeApi();
  const render = await renderPage();

  const apiHit = api.find(r => r.isJson && r.status >= 200 && r.status < 300);

  const result = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: MEETING_URL,
    meetingId: MEETING_ID,
    // Voorkeur: API-data; anders wat de browser rende (indien niet geblokkeerd).
    dataSource: apiHit ? 'notubiz-api' : (render.cloudflareBlocked ? 'blocked' : 'browser'),
    title: (apiHit && (apiHit.json.title || apiHit.json.name)) || render.extracted?.title || null,
    status: apiHit ? `api-${apiHit.status}` : render.status,
    cloudflareBlocked: render.cloudflareBlocked,
    agenda: apiHit ? agendaFromApiJson(apiHit.json) : (render.extracted?.agenda || []),
    videoLinks: render.networkVideo || [],
    iframeSrcs: render.extracted?.iframeSrcs || [],
  };

  const debug = { fetchedAt: result.fetchedAt, api, render };

  await writeFile(`${OUT_DIR}/zuidplas.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${OUT_DIR}/zuidplas-debug.json`, JSON.stringify(debug, null, 2) + '\n');

  console.log(
    `Klaar. dataSource=${result.dataSource} status=${result.status} ` +
    `cloudflareBlocked=${result.cloudflareBlocked} apiHit=${!!apiHit} ` +
    `agendapunten=${result.agenda.length} video=${result.videoLinks.length}`
  );
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
