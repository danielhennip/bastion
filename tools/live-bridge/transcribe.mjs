// Zuidplas Live-brug — lokaal transcriberen van de live raadsvergadering.
//
// Draait op JOUW computer (thuis-/kantoor-IP), niet in Claude's omgeving:
// alleen zo komt het geluid van de Cloudflare-beschermde Notubiz-stream binnen.
//
// Werking (v2 — continu, geen gaten meer):
//   1. ffmpeg neemt ONONDERBROKEN op en knipt zelf in blokken van
//      CHUNK_SECONDS (segment-muxer). Er gaat dus geen seconde geluid
//      verloren, ook niet terwijl Whisper nog aan het transcriberen is.
//   2. Een aparte verwerk-lus transcribeert de voltooide blokken op volgorde
//      (whisper.cpp, OpenAI, of gratis lokaal via LOCAL_WHISPER=1).
//   3. Tekst wordt doorlopend aan data/zuidplas-live.md toegevoegd, plus een
//      statusbestand data/zuidplas-live-status.json (voor de LIVE-badge).
//   4. Met PUSH=1 wordt er periodiek gecommit + gepusht. Fouten worden LUID
//      gemeld (niet meer stilletjes genegeerd) met uitleg wat te doen.
//
// Zie WINDOWS.md voor setup. Config via tools/live-bridge/.env.

import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, appendFile, writeFile, mkdir, unlink, readdir, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..', '..');

// Laad een lokaal .env-bestand (KEY=VALUE per regel) als het bestaat.
(function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

// ── Config via env-vars ──────────────────────────────────────────
const CHUNK_SECONDS = Number(process.env.CHUNK_SECONDS || 30);
const OUT_FILE = process.env.OUT_FILE || join(REPO_DIR, 'data', 'zuidplas-live.md');
const STATUS_FILE = join(dirname(OUT_FILE), 'zuidplas-live-status.json');
const DO_PUSH = process.env.PUSH === '1';
const PUSH_INTERVAL_SECONDS = Number(process.env.PUSH_INTERVAL_SECONDS || 90);
// Automatisch stoppen na N minuten (0 = doorgaan tot Ctrl+C). Gebruikt door
// de onbemande autostart (AUTO-LIVE.cmd) zodat de brug zichzelf afsluit.
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 0);

const FFMPEG_FORMAT = process.env.FFMPEG_FORMAT || 'pulse';
const FFMPEG_INPUT = process.env.FFMPEG_INPUT || 'default';

// Transcriptie: whisper.cpp (WHISPER_CPP + WHISPER_MODEL), OpenAI (OPENAI_API_KEY),
// of gratis lokaal via het Python-pakket 'openai-whisper' (LOCAL_WHISPER=1).
const WHISPER_CPP = process.env.WHISPER_CPP;
const WHISPER_MODEL = process.env.WHISPER_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'whisper-1';
const LOCAL_WHISPER = process.env.LOCAL_WHISPER === '1';
const LOCAL_WHISPER_MODEL_SIZE = process.env.WHISPER_MODEL_SIZE || 'base';

// Context-hint voor Whisper: betere herkenning van raadsjargon en namen.
const INITIAL_PROMPT = process.env.WHISPER_PROMPT ||
  'Vergadering van de gemeenteraad van Zuidplas. De voorzitter, wethouders en raadsleden bespreken agendapunten, moties en amendementen.';

function log(...a) { console.log(new Date().toLocaleTimeString('nl-NL'), ...a); }
function warn(...a) { console.warn(new Date().toLocaleTimeString('nl-NL'), '⚠', ...a); }

function banner(lines) {
  const width = Math.max(...lines.map(l => l.length)) + 4;
  console.log('\n' + '═'.repeat(width));
  for (const l of lines) console.log('  ' + l);
  console.log('═'.repeat(width) + '\n');
}

// ── Continu opnemen: één ffmpeg-proces knipt zelf in segmenten ───
function startRecorder(dir) {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', FFMPEG_FORMAT, '-i', FFMPEG_INPUT,
    '-ac', '1', '-ar', '16000',
    '-f', 'segment', '-segment_time', String(CHUNK_SECONDS),
    '-reset_timestamps', '1',
    join(dir, 'chunk-%06d.wav'),
  ];
  const p = spawn('ffmpeg', args);
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('close', code => {
    if (code !== 0 && !shuttingDown) {
      banner([
        'FFMPEG GESTOPT MET FOUT:',
        ...err.trim().split('\n').slice(-5),
        '',
        'Controleer of de audiobron klopt (FFMPEG_INPUT in .env) en of',
        'Stereo Mix aan staat. Daarna dit venster sluiten en opnieuw starten.',
      ]);
      process.exitCode = 1;
      shuttingDown = true;
    }
  });
  return p;
}

// ── Transcriptie-engines ─────────────────────────────────────────
async function transcribeWhisperCpp(wavPath) {
  await execFileP(WHISPER_CPP, [
    '-m', WHISPER_MODEL, '-f', wavPath, '-l', 'nl', '-otxt', '-nt',
  ], { maxBuffer: 1024 * 1024 * 32 });
  const txt = await readFile(wavPath + '.txt', 'utf8').catch(() => '');
  await unlink(wavPath + '.txt').catch(() => {});
  return txt.trim();
}

async function transcribeOpenAI(wavPath) {
  const data = await readFile(wavPath);
  const form = new FormData();
  form.append('file', new Blob([data], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', OPENAI_MODEL);
  form.append('language', 'nl');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.text || '').trim();
}

async function transcribeLocalWhisper(wavPath) {
  // Gratis, lokaal: het Python-pakket 'openai-whisper' (pip install openai-whisper).
  // --condition_on_previous_text False voorkomt dat een fout in één blok
  // doorwerkt (herhaal-hallucinaties) — elk blok staat op zichzelf.
  const outDir = dirname(wavPath);
  await execFileP('whisper', [
    wavPath, '--model', LOCAL_WHISPER_MODEL_SIZE, '--language', 'nl',
    '--output_format', 'txt', '--output_dir', outDir, '--fp16', 'False',
    '--condition_on_previous_text', 'False',
    '--initial_prompt', INITIAL_PROMPT,
    '--verbose', 'False',
  ], { maxBuffer: 1024 * 1024 * 64 });
  const base = wavPath.replace(/\.wav$/i, '');
  const txt = await readFile(base + '.txt', 'utf8').catch(() => '');
  await unlink(base + '.txt').catch(() => {});
  return txt.replace(/\s+/g, ' ').trim();
}

async function transcribe(wavPath) {
  if (WHISPER_CPP && WHISPER_MODEL) return transcribeWhisperCpp(wavPath);
  if (OPENAI_API_KEY) return transcribeOpenAI(wavPath);
  if (LOCAL_WHISPER) return transcribeLocalWhisper(wavPath);
  throw new Error('Geen transcriptie-optie: zet WHISPER_CPP+WHISPER_MODEL, OPENAI_API_KEY, of LOCAL_WHISPER=1 in .env.');
}

// ── Git: luid falen, nooit stil ──────────────────────────────────
async function git(...args) {
  return execFileP('git', args, { cwd: REPO_DIR });
}

async function ensureGitIdentity() {
  try { const { stdout } = await git('config', 'user.email'); if (stdout.trim()) return; } catch {}
  await git('config', 'user.name', 'Zuidplas Live-brug').catch(() => {});
  await git('config', 'user.email', 'live-bridge@bastion.local').catch(() => {});
  log('Git-identiteit lokaal ingesteld (alleen voor deze repo).');
}

let pushBroken = false;
async function gitPushBatch() {
  try {
    await git('add', OUT_FILE, STATUS_FILE);
    const { stdout: status } = await git('status', '--porcelain', '--', OUT_FILE, STATUS_FILE);
    if (!status.trim()) return;
    await git('commit', '-m', 'chore: update live transcript Zuidplas', '--quiet');
    await git('pull', '--rebase', '--quiet').catch(() => {}); // haal evt. AI-notities binnen
    await git('push', 'origin', 'HEAD');
    if (pushBroken) { log('✓ Push werkt weer.'); pushBroken = false; }
    else log('✓ Transcript gepusht naar GitHub.');
  } catch (e) {
    const msg = String((e && e.stderr) || (e && e.message) || e);
    if (!pushBroken) {
      pushBroken = true;
      banner([
        'GIT PUSH MISLUKT — het transcript blijft wél lokaal bewaard,',
        'maar komt NIET bij Claude/het dashboard aan. Foutmelding:',
        '',
        ...msg.trim().split('\n').slice(-6),
        '',
        'Meestal betekent dit: nog niet ingelogd bij GitHub.',
        'Oplossing: open een nieuw PowerShell-venster en typ daar:',
        '    cd ' + REPO_DIR,
        '    git push',
        'Er opent dan een browservenster om in te loggen bij GitHub.',
        'Dit hoeft maar één keer. Dit script blijft ondertussen doorlopen.',
      ]);
    }
  }
}

async function pushSelfTest() {
  try {
    await git('push', '--dry-run', 'origin', 'HEAD');
    log('✓ GitHub-verbinding OK (push-test geslaagd).');
    return true;
  } catch (e) {
    const msg = String((e && e.stderr) || (e && e.message) || e);
    banner([
      'LET OP: proef-push naar GitHub mislukte. Foutmelding:',
      '',
      ...msg.trim().split('\n').slice(-5),
      '',
      'Als er zojuist een browservenster opende: log daar in bij GitHub',
      'en start dit script daarna opnieuw. Transcriberen gaat wel gewoon door.',
    ]);
    return false;
  }
}

// ── Status voor het dashboard (LIVE/OFFLINE-badge) ───────────────
let chunksDone = 0;
async function writeStatus(extra = {}) {
  const status = {
    updatedAt: new Date().toISOString(),
    running: !shuttingDown,
    chunkSeconds: CHUNK_SECONDS,
    chunksDone,
    model: LOCAL_WHISPER ? `whisper-${LOCAL_WHISPER_MODEL_SIZE} (lokaal)` : (OPENAI_API_KEY ? OPENAI_MODEL : 'whisper.cpp'),
    ...extra,
  };
  await writeFile(STATUS_FILE, JSON.stringify(status, null, 2) + '\n').catch(() => {});
}

// ── Hoofdlus ─────────────────────────────────────────────────────
let shuttingDown = false;

async function main() {
  await mkdir(dirname(OUT_FILE), { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), 'zuidplas-live-'));

  log(`Live-brug v2 gestart. Continu opnemen in blokken van ${CHUNK_SECONDS}s.`);
  log('Transcript →', OUT_FILE);
  log(DO_PUSH ? `Auto-push AAN (elke ~${PUSH_INTERVAL_SECONDS}s).` : 'Auto-push UIT (zet PUSH=1 in .env voor live sync).');

  if (DO_PUSH) {
    await ensureGitIdentity();
    await pushSelfTest();
  }

  await appendFile(OUT_FILE, `\n\n## Sessie gestart ${new Date().toLocaleString('nl-NL')}\n\n`);
  await writeStatus();

  const recorder = startRecorder(tmp);
  const sessionStart = Date.now();

  process.on('SIGINT', () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log('Stoppen… (laatste blokken worden nog verwerkt)');
    try { recorder.kill(); } catch {}
  });

  let next = 0;              // volgend te verwerken segment-nummer
  let lastPush = Date.now();
  let lagWarned = false;

  const chunkName = i => `chunk-${String(i).padStart(6, '0')}.wav`;

  while (true) {
    if (MAX_MINUTES > 0 && !shuttingDown && Date.now() - sessionStart > MAX_MINUTES * 60 * 1000) {
      shuttingDown = true;
      log(`Maximale duur van ${MAX_MINUTES} min bereikt — netjes afronden…`);
      try { recorder.kill(); } catch {}
    }
    // Segment `next` is klaar zodra segment `next+1` bestaat (ffmpeg is er
    // dan zeker mee klaar), of zodra ffmpeg gestopt is (laatste segment).
    const files = new Set(await readdir(tmp).catch(() => []));
    const currentDone = files.has(chunkName(next)) &&
      (files.has(chunkName(next + 1)) || recorder.exitCode !== null);

    if (!currentDone) {
      if (shuttingDown && recorder.exitCode !== null && !files.has(chunkName(next))) break;
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }

    const wav = join(tmp, chunkName(next));
    // Wandkloktijd van het BEGIN van dit blok — zo kloppen de tijdstempels
    // ook als de transcriptie achterloopt.
    const stamp = new Date(sessionStart + next * CHUNK_SECONDS * 1000).toLocaleTimeString('nl-NL');

    try {
      const size = (await stat(wav)).size;
      if (size > 44) { // niet-lege WAV
        const text = await transcribe(wav);
        if (text) {
          await appendFile(OUT_FILE, `**[${stamp}]** ${text}\n\n`);
          log(`[blok ${next}] + ${text.slice(0, 90)}${text.length > 90 ? '…' : ''}`);
        } else {
          log(`[blok ${next}] (stilte)`);
        }
      }
      chunksDone++;
      await writeStatus();
    } catch (e) {
      warn(`Blok ${next} mislukt:`, String((e && e.message) || e).slice(0, 300));
    }
    await unlink(wav).catch(() => {});
    next++;

    // Achterstands-bewaking: hoeveel voltooide blokken wachten er nog?
    const backlog = [...files].filter(f => /^chunk-\d+\.wav$/.test(f)).length - 1;
    if (backlog >= 3 && !lagWarned) {
      lagWarned = true;
      warn(`Transcriptie loopt ${backlog} blokken (~${backlog * CHUNK_SECONDS}s) achter.`);
      warn(`Tip: zet in .env een sneller model (WHISPER_MODEL_SIZE=base of tiny).`);
    } else if (backlog <= 1) {
      lagWarned = false;
    }

    if (DO_PUSH && Date.now() - lastPush > PUSH_INTERVAL_SECONDS * 1000) {
      lastPush = Date.now();
      await gitPushBatch();
    }
  }

  await writeStatus({ running: false });
  await appendFile(OUT_FILE, `\n_Sessie beëindigd ${new Date().toLocaleString('nl-NL')}._\n`);
  if (DO_PUSH) await gitPushBatch();
  log('Live-brug gestopt. Alles verwerkt en opgeslagen.');
}

main().catch(e => { console.error(e); process.exit(1); });
