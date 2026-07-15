// Haalt de Notubiz-vergaderpagina van gemeente Zuidplas op en zet er
// zo veel mogelijk bruikbare data uit in data/zuidplas.json voor BASTION.
//
// Draait als GitHub Action (onbeperkte netwerktoegang, i.t.t. de Claude-
// sandbox die notubiz.nl blokkeert). Schrijft daarnaast data/zuidplas-debug.json
// met ruwe vondsten, zodat het parseergedeelte hieronder later — zonder dat
// iemand de site handmatig hoeft te inspecteren — bijgesteld kan worden aan
// de hand van wat er daadwerkelijk binnenkomt.

import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'node:fs/promises';

const MEETING_URL = process.env.ZUIDPLAS_MEETING_URL || 'https://zuidplas.notubiz.nl/vergadering/1391079';
const PORTAL_URL = 'https://zuidplas.notubiz.nl/';
const OUT_DIR = 'data';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text, finalUrl: res.url };
}

function extractCandidates($, html) {
  const title = $('title').first().text().trim()
    || $('meta[property="og:title"]').attr('content')
    || null;

  const description = $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || null;

  // Veel Notubiz-installaties zijn een SPA; probeer bekende data-bootstrap-patronen te vinden.
  const embeddedJsonBlocks = [];
  $('script').each((_, el) => {
    const id = $(el).attr('id') || '';
    const type = $(el).attr('type') || '';
    const body = $(el).html() || '';
    const head = (id + ' ' + type + ' ' + body.slice(0, 200)).toLowerCase();
    if (/__next_data__|__nuxt__|initial[-_]?state|window\.__|application\/json/.test(head)) {
      embeddedJsonBlocks.push({ id, type, length: body.length, preview: body.slice(0, 800) });
    }
  });

  // Kandidaat-agendapunten via veelvoorkomende klassenpatronen.
  const agendaSelectors = [
    '[class*="agenda" i] li',
    '[class*="agenda" i] a',
    '[class*="punt" i]',
    '[id*="agenda" i] li',
    'li[class*="item" i]',
  ];
  const agendaCandidates = new Set();
  for (const sel of agendaSelectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length > 3 && t.length < 200) agendaCandidates.add(t);
    });
  }

  // Kandidaat video/livestream-bronnen.
  const videoLinks = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
    /https?:\/\/[^\s"'<>]*(mistserver|vimeo|youtube|notubiz-media|player)[^\s"'<>]*/gi,
  ];
  for (const p of patterns) {
    const matches = html.match(p) || [];
    matches.forEach(m => videoLinks.add(m));
  }
  const iframeSrcs = new Set();
  $('iframe').each((_, el) => {
    const s = $(el).attr('src');
    if (s) iframeSrcs.add(s);
  });

  return {
    title,
    description,
    embeddedJsonBlocks: embeddedJsonBlocks.slice(0, 10),
    agendaCandidates: Array.from(agendaCandidates).slice(0, 60),
    videoLinks: Array.from(videoLinks).slice(0, 10),
    iframeSrcs: Array.from(iframeSrcs).slice(0, 10),
    bodyTextPreview: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1500),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const result = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: MEETING_URL,
    title: null,
    status: 'unknown',
    agenda: [],
    videoLinks: [],
    iframeSrcs: [],
    error: null,
  };
  const debug = { fetchedAt: result.fetchedAt, meeting: null, portal: null };

  try {
    const meeting = await fetchHtml(MEETING_URL);
    const $m = cheerio.load(meeting.text);
    const info = extractCandidates($m, meeting.text);
    debug.meeting = { httpStatus: meeting.status, finalUrl: meeting.finalUrl, ...info };

    result.title = info.title;
    result.agenda = info.agendaCandidates;
    result.videoLinks = info.videoLinks;
    result.iframeSrcs = info.iframeSrcs;
    result.status = meeting.ok ? 'fetched' : `http-${meeting.status}`;
  } catch (e) {
    result.error = String((e && e.message) || e);
    result.status = 'error';
    debug.meetingError = result.error;
  }

  try {
    const portal = await fetchHtml(PORTAL_URL);
    const $p = cheerio.load(portal.text);
    debug.portal = { httpStatus: portal.status, finalUrl: portal.finalUrl, ...extractCandidates($p, portal.text) };
  } catch (e) {
    debug.portalError = String((e && e.message) || e);
  }

  await writeFile(`${OUT_DIR}/zuidplas.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${OUT_DIR}/zuidplas-debug.json`, JSON.stringify(debug, null, 2) + '\n');

  console.log(`Klaar. status=${result.status} title=${result.title} agendapunten=${result.agenda.length}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
