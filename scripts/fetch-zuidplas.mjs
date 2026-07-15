// Rendert de Notubiz-vergaderpagina van gemeente Zuidplas in een échte
// (headless) Chromium en haalt er data uit voor BASTION.
//
// Waarom een browser i.p.v. een kale fetch? Notubiz zit achter Cloudflare-
// botbescherming: een gewone HTTP-request krijgt "Attention Required! |
// Cloudflare" (HTTP 403). Een echte browser doorstaat die controle wél —
// net als de browser van de gebruiker.
//
// Draait als GitHub Action (onbeperkte netwerktoegang). Schrijft:
//   data/zuidplas.json        → gestructureerde data voor het dashboard
//   data/zuidplas-debug.json  → ruwe vondsten om de parser bij te stellen
//   data/zuidplas.png         → screenshot van de gerenderde pagina, zodat
//                               ook een AI de vergaderpagina kan "bekijken"

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const MEETING_URL = process.env.ZUIDPLAS_MEETING_URL || 'https://zuidplas.notubiz.nl/vergadering/1391079';
const OUT_DIR = 'data';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const result = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: MEETING_URL,
    title: null,
    status: 'unknown',
    cloudflareBlocked: false,
    agenda: [],
    videoLinks: [],
    iframeSrcs: [],
    error: null,
  };
  const debug = { fetchedAt: result.fetchedAt };

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'nl-NL',
    viewport: { width: 1440, height: 2200 },
    timezoneId: 'Europe/Amsterdam',
  });

  // Verzamel netwerk-URL's die op een videostream lijken.
  const networkVideo = new Set();
  context.on('request', req => {
    const u = req.url();
    if (/\.m3u8|\.mpd|mistserver|companywebcast|player\.|vimeo|youtube|stream/i.test(u)) {
      networkVideo.add(u);
    }
  });

  const page = await context.newPage();

  try {
    const resp = await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.status = resp ? `http-${resp.status()}` : 'no-response';

    // Geef Cloudflare + de SPA tijd om te laden.
    await page.waitForTimeout(6000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

    const pageTitle = await page.title().catch(() => '');
    result.cloudflareBlocked = /just a moment|attention required|cloudflare/i.test(pageTitle);

    // Screenshot van de volledige pagina — dit is wat een AI kan "bekijken".
    await page.screenshot({ path: `${OUT_DIR}/zuidplas.png`, fullPage: true }).catch(() => {});

    // Extractie uit de gerenderde DOM.
    const extracted = await page.evaluate(() => {
      const clean = s => (s || '').replace(/\s+/g, ' ').trim();

      const title =
        document.querySelector('h1, h2, .meeting-title, [class*="title" i]')?.textContent?.trim()
        || document.title
        || null;

      const agenda = [];
      const seen = new Set();
      const selectors = [
        '[class*="agenda" i] li',
        '[class*="agenda" i] a',
        'ol li',
        'ul li a',
        '[class*="point" i]',
        '[class*="punt" i]',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length > 3 && t.length < 220 && !seen.has(t)) {
            seen.add(t);
            agenda.push(t);
          }
        });
      }

      const iframeSrcs = Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src).filter(Boolean);
      const videoSrcs = Array.from(document.querySelectorAll('video, video source'))
        .map(v => v.src || v.currentSrc).filter(Boolean);

      return {
        title: clean(title),
        agenda: agenda.slice(0, 80),
        iframeSrcs,
        videoSrcs,
        bodyTextPreview: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
      };
    });

    result.title = extracted.title;
    result.agenda = extracted.agenda;
    result.iframeSrcs = extracted.iframeSrcs;
    result.videoLinks = Array.from(new Set([...extracted.videoSrcs, ...networkVideo])).slice(0, 15);

    debug.pageTitle = pageTitle;
    debug.extracted = extracted;
    debug.networkVideo = Array.from(networkVideo).slice(0, 30);
  } catch (e) {
    result.error = String((e && e.message) || e);
    result.status = 'error';
    debug.error = result.error;
    // Probeer alsnog een screenshot van wat er wél staat.
    await page.screenshot({ path: `${OUT_DIR}/zuidplas.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  await writeFile(`${OUT_DIR}/zuidplas.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${OUT_DIR}/zuidplas-debug.json`, JSON.stringify(debug, null, 2) + '\n');

  console.log(
    `Klaar. status=${result.status} cloudflareBlocked=${result.cloudflareBlocked} ` +
    `title=${JSON.stringify(result.title)} agendapunten=${result.agenda.length} ` +
    `video=${result.videoLinks.length} iframes=${result.iframeSrcs.length}`
  );
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
