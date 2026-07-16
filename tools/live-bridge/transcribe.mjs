// Zuidplas Live-brug — lokaal transcriberen van de live raadsvergadering (v3).
//
// Draait op JOUW computer (thuis-/kantoor-IP), niet in Claude's omgeving:
// alleen zo komt het geluid van de Cloudflare-beschermde Notubiz-stream binnen.
//
// Architectuur (v3):
//   1. ffmpeg neemt ONONDERBROKEN op en knipt zelf in blokken van
//      CHUNK_SECONDS (60s). Geen seconde geluid gaat verloren.
//   2. whisper_worker.py (faster-whisper) laadt het model ÉÉN keer en
//      transcribeert blok na blok — met stiltefilter en raadscontext.
//      Modelkeuze 'auto': de pc test zichzelf en kiest het beste model
//      dat live bijgehouden kan worden (small/medium; terugval base).
//   3. Dit script bewaakt alles: tijdstempels, transcript-markdown,
//      statusbestand, periodieke git push (met luide foutmeldingen).
//
// Alternatieve engines blijven werken: OPENAI_API_KEY (cloud, betaald)
// of WHISPER_CPP+WHISPER_MODEL (whisper.cpp). LOCAL_WHISPER=1 = gratis
// lokaal via de worker; als faster-whisper ontbreekt valt hij terug op
// de klassieke 'whisper'-CLI (openai-whisper).
//
// Config via tools/live-bridge/.env — zie WINDOWS.md.

import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, appendFile, writeFile, mkdir, unlink, readdir, stat, rename } from 'node:fs/promises';
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

// ── Config ───────────────────────────────────────────────────────
const CHUNK_SECONDS = Number(process.env.CHUNK_SECONDS || 60);
const OUT_FILE = process.env.OUT_FILE || join(REPO_DIR, 'data', 'zuidplas-live.md');
const STATUS_FILE = join(dirname(OUT_FILE), 'zuidplas-live-status.json');
const DO_PUSH = process.env.PUSH === '1';
const PUSH_INTERVAL_SECONDS = Number(process.env.PUSH_INTERVAL_SECONDS || 90);
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 0); // 0 = tot Ctrl+C

const FFMPEG_FORMAT = process.env.FFMPEG_FORMAT || 'pulse';
const FFMPEG_INPUT = process.env.FFMPEG_INPUT || 'default';

const WHISPER_CPP = process.env.WHISPER_CPP;
const WHISPER_MODEL = process.env.WHISPER_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'whisper-1';
const LOCAL_WHISPER = process.env.LOCAL_WHISPER === '1';
const MODEL_SIZE = process.env.WHISPER_MODEL_SIZE || 'auto';
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

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

const chunkName = i => `chunk-${String(i).padStart(6, '0')}.wav`;

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

// ── Inline transcriptie-engines (OpenAI / whisper.cpp / legacy) ──
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

// Terugval als faster-whisper ontbreekt: klassieke openai-whisper CLI.
async function transcribeLegacyWhisper(wavPath) {
  const outDir = dirname(wavPath);
  const size = MODEL_SIZE === 'auto' ? 'base' : MODEL_SIZE;
  await execFileP('whisper', [
    wavPath, '--model', size, '--language', 'nl',
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

// ── faster-whisper-werker (voorkeursroute, gratis en snel) ───────
let workerFailed = false;
let workerExited = false;
let workerModel = '';
function startWorker(readyDir) {
  const p = spawn(PYTHON, [join(__dirname, 'whisper_worker.py'), '--dir', readyDir, '--model', MODEL_SIZE]);
  p.stdout.on('data', d => {
    for (const line of String(d).split('\n')) {
      if (!line.trim()) continue;
      if (line.startsWith('READY ')) { workerModel = line.slice(6).trim(); log(`✓ Transcriptie-werker klaar (model: ${workerModel}).`); }
      else console.log(line);
    }
  });
  p.stderr.on('data', d => process.stderr.write(String(d)));
  p.on('close', code => {
    workerExited = true;
    if (code === 3) {
      workerFailed = true;
      warn('faster-whisper niet geïnstalleerd — terugvallen op klassieke whisper-CLI (langzamer/minder goed).');
      warn('Snelle fix: pip install faster-whisper   (daarna opnieuw starten)');
    } else if (code !== 0 && !shuttingDown) {
      workerFailed = true;
      warn(`Transcriptie-werker stopte onverwacht (code ${code}) — terugvallen op klassieke whisper-CLI.`);
    }
  });
  p.on('error', () => {
    workerFailed = true;
    warn(`Kon '${PYTHON}' niet starten — terugvallen op klassieke whisper-CLI.`);
  });
  return p;
}

// ── Git: luid falen, nooit stil ──────────────────────────────────
async function git(...args) { return execFileP('git', args, { cwd: REPO_DIR }); }

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
    await git('pull', '--rebase', '--quiet').catch(() => {});
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
  }
}

// ── Status voor het dashboard ────────────────────────────────────
let chunksDone = 0;
let backlogNow = 0;
async function writeStatus(extra = {}) {
  const engine = (LOCAL_WHISPER && !workerFailed)
    ? `faster-whisper ${workerModel || MODEL_SIZE} (lokaal)`
    : OPENAI_API_KEY ? OPENAI_MODEL
    : (WHISPER_CPP ? 'whisper.cpp' : 'whisper (legacy, lokaal)');
  const status = {
    updatedAt: new Date().toISOString(),
    running: !shuttingDown,
    chunkSeconds: CHUNK_SECONDS,
    chunksDone,
    backlog: backlogNow,
    model: engine,
    ...extra,
  };
  await writeFile(STATUS_FILE, JSON.stringify(status, null, 2) + '\n').catch(() => {});
}

// ── Hoofdlus ─────────────────────────────────────────────────────
let shuttingDown = false;

async function main() {
  await mkdir(dirname(OUT_FILE), { recursive: true });
  const recDir = await mkdtemp(join(tmpdir(), 'zuidplas-rec-'));
  const readyDir = await mkdtemp(join(tmpdir(), 'zuidplas-ready-'));

  const useWorker = LOCAL_WHISPER && !OPENAI_API_KEY && !WHISPER_CPP;

  log(`Live-brug v3 gestart. Continu opnemen in blokken van ${CHUNK_SECONDS}s.`);
  log('Transcript →', OUT_FILE);
  log(DO_PUSH ? `Auto-push AAN (elke ~${PUSH_INTERVAL_SECONDS}s).` : 'Auto-push UIT (zet PUSH=1 in .env voor live sync).');
  if (MAX_MINUTES > 0) log(`Stopt automatisch na ${MAX_MINUTES} minuten.`);

  if (DO_PUSH) { await ensureGitIdentity(); await pushSelfTest(); }

  await appendFile(OUT_FILE, `\n\n## Sessie gestart ${new Date().toLocaleString('nl-NL')}\n\n`);
  await writeStatus();

  const recorder = startRecorder(recDir);
  let recorderExited = false;
  // Let op: bij een kill-signaal blijft child.exitCode voor altijd null —
  // daarom een expliciete vlag via het exit-event.
  recorder.on('exit', () => { recorderExited = true; });
  const worker = useWorker ? startWorker(readyDir) : null;
  const sessionStart = Date.now();

  process.on('SIGINT', () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log('Stoppen… (resterende blokken worden nog verwerkt)');
    try { recorder.kill(); } catch {}
  });

  let moved = 0;    // volgende op te pakken opname
  let outIdx = 0;   // volgende te verwachten transcript
  let shutdownAt = 0;
  let lastPush = Date.now();
  let lagWarned = false;
  const stampFor = i => new Date(sessionStart + i * CHUNK_SECONDS * 1000).toLocaleTimeString('nl-NL');

  async function emit(idx, text) {
    if (text) {
      await appendFile(OUT_FILE, `**[${stampFor(idx)}]** ${text}\n\n`);
      log(`[blok ${idx}] + ${text.slice(0, 90)}${text.length > 90 ? '…' : ''}`);
    } else {
      log(`[blok ${idx}] (stilte)`);
    }
    chunksDone++;
    await writeStatus();
    if (DO_PUSH && Date.now() - lastPush > PUSH_INTERVAL_SECONDS * 1000) {
      lastPush = Date.now();
      await gitPushBatch();
    }
  }

  let recovered = false;
  while (true) {
    // Werker uitgevallen? Zet nog niet verwerkte blokken terug zodat de
    // klassieke route (whisper-CLI) ze alsnog oppakt — niets raakt kwijt.
    if (useWorker && workerFailed && !recovered) {
      recovered = true;
      for (const f of (await readdir(readyDir).catch(() => []))) {
        if (f.endsWith('.wav')) await rename(join(readyDir, f), join(recDir, f)).catch(() => {});
      }
      moved = outIdx;
    }
    if (MAX_MINUTES > 0 && !shuttingDown && Date.now() - sessionStart > MAX_MINUTES * 60 * 1000) {
      shuttingDown = true;
      log(`Maximale duur van ${MAX_MINUTES} min bereikt — netjes afronden…`);
      try { recorder.kill(); } catch {}
    }

    // 1. Voltooide opnames doorzetten (blok i is klaar als i+1 bestaat of ffmpeg stopte).
    const recFiles = new Set(await readdir(recDir).catch(() => []));
    while (recFiles.has(chunkName(moved)) &&
           (recFiles.has(chunkName(moved + 1)) || recorderExited)) {
      const src = join(recDir, chunkName(moved));
      const size = (await stat(src).catch(() => ({ size: 0 }))).size;
      if (size <= 44) { await unlink(src).catch(() => {}); if (useWorker && !workerFailed) outIdx = Math.max(outIdx, moved + 1); moved++; continue; }
      if (useWorker && !workerFailed) {
        await rename(src, join(readyDir, chunkName(moved)));
      } else {
        // Inline engine: hier direct transcriberen (blokkeert het doorzetten niet lang,
        // want de opname loopt in ffmpeg gewoon door).
        let text = '';
        try {
          text = OPENAI_API_KEY ? await transcribeOpenAI(src)
               : WHISPER_CPP ? await transcribeWhisperCpp(src)
               : await transcribeLegacyWhisper(src);
        } catch (e) {
          warn(`Blok ${moved} mislukt:`, String((e && e.message) || e).slice(0, 300));
        }
        await unlink(src).catch(() => {});
        await emit(moved, text);
        outIdx = moved + 1;
      }
      moved++;
    }

    // 2. Resultaten van de werker ophalen (op volgorde).
    if (useWorker && !workerFailed) {
      while (true) {
        const txtPath = join(readyDir, chunkName(outIdx).replace('.wav', '.txt'));
        const txt = await readFile(txtPath, 'utf8').catch(() => null);
        if (txt === null) break;
        await unlink(txtPath).catch(() => {});
        await emit(outIdx, txt.replace(/\s+/g, ' ').trim());
        outIdx++;
      }
      backlogNow = moved - outIdx;
      if (backlogNow >= 3 && !lagWarned) {
        lagWarned = true;
        warn(`Transcriptie loopt ${backlogNow} blokken (~${backlogNow * CHUNK_SECONDS}s) achter — de werker haalt dit meestal in tijdens stiltes.`);
      } else if (backlogNow <= 1) lagWarned = false;
    }

    // 3. Klaar? Alles opgenomen én alles getranscribeerd.
    if (shuttingDown && recorderExited) {
      if (!shutdownAt) shutdownAt = Date.now();
      const leftover = (await readdir(recDir).catch(() => [])).some(f => f.endsWith('.wav'));
      const workerAlive = worker && !workerExited && !workerFailed;
      const pending = useWorker && workerAlive && outIdx < moved;
      if (!leftover && !pending) break;
      if ((Date.now() - shutdownAt) % 10000 < 1600) {
        log(`Afronden… (nog te verwerken: opnames=${leftover ? 'ja' : 'nee'}, transcripties=${Math.max(0, moved - outIdx)}, werker=${workerAlive ? 'actief' : 'gestopt'})`);
      }
      if (Date.now() - shutdownAt > 15 * 60 * 1000) {
        warn('Afronden duurt te lang (>15 min) — stoppen met wat er is. Transcript tot hier is compleet opgeslagen.');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  if (worker) { await writeFile(join(readyDir, 'STOP'), '').catch(() => {}); }
  await writeStatus({ running: false });
  await appendFile(OUT_FILE, `\n_Sessie beëindigd ${new Date().toLocaleString('nl-NL')}._\n`);
  if (DO_PUSH) await gitPushBatch();
  log('Live-brug gestopt. Alles verwerkt en opgeslagen.');
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error(e); process.exit(1); });
