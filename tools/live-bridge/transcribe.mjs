// Zuidplas Live-brug — lokaal transcriberen van de live raadsvergadering.
//
// Draait op JOUW computer (thuis-/kantoor-IP), niet in Claude's omgeving:
// alleen zo komt het geluid van de Cloudflare-beschermde Notubiz-stream binnen.
// Neemt in blokjes op met ffmpeg, transcribeert (whisper.cpp of OpenAI API),
// en schrijft doorlopend naar data/zuidplas-live.md. Met PUSH=1 ook git push.
//
// Zie README.md voor setup (ffmpeg-invoer, transcriptie-optie).

import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, appendFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config via env-vars ──────────────────────────────────────────
const CHUNK_SECONDS = Number(process.env.CHUNK_SECONDS || 30);
const OUT_FILE = process.env.OUT_FILE || join(__dirname, '..', '..', 'data', 'zuidplas-live.md');
const DO_PUSH = process.env.PUSH === '1';

// ffmpeg-invoer (zie README): standaard PulseAudio-monitor op Linux.
const FFMPEG_FORMAT = process.env.FFMPEG_FORMAT || 'pulse';
const FFMPEG_INPUT = process.env.FFMPEG_INPUT || 'default';

// Transcriptie: whisper.cpp (WHISPER_CPP + WHISPER_MODEL) of OpenAI (OPENAI_API_KEY).
const WHISPER_CPP = process.env.WHISPER_CPP;
const WHISPER_MODEL = process.env.WHISPER_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'whisper-1';

function log(...a) { console.log(new Date().toLocaleTimeString('nl-NL'), ...a); }

// Neem één audioblok op als 16kHz mono WAV (ideaal voor whisper).
function recordChunk(path) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', FFMPEG_FORMAT, '-i', FFMPEG_INPUT,
      '-t', String(CHUNK_SECONDS),
      '-ac', '1', '-ar', '16000',
      '-y', path,
    ];
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg faalde: ' + err)));
  });
}

async function transcribeWhisperCpp(wavPath) {
  // whisper.cpp schrijft <wav>.txt met -otxt.
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

async function transcribe(wavPath) {
  if (WHISPER_CPP && WHISPER_MODEL) return transcribeWhisperCpp(wavPath);
  if (OPENAI_API_KEY) return transcribeOpenAI(wavPath);
  throw new Error('Geen transcriptie-optie: zet WHISPER_CPP+WHISPER_MODEL of OPENAI_API_KEY.');
}

async function gitPush() {
  try {
    await execFileP('git', ['add', OUT_FILE]);
    await execFileP('git', ['commit', '-m', 'chore: update live transcript Zuidplas', '--quiet']);
    await execFileP('git', ['push']);
  } catch { /* niets te committen of push mislukt — negeren, volgende ronde */ }
}

async function main() {
  await mkdir(dirname(OUT_FILE), { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), 'zuidplas-live-'));
  log('Live-brug gestart. Blokjes van', CHUNK_SECONDS, 's. Schrijft naar', OUT_FILE);
  log(DO_PUSH ? 'Auto-push AAN.' : 'Auto-push UIT (zet PUSH=1 voor live sync).');

  await appendFile(OUT_FILE, `\n\n## Sessie gestart ${new Date().toLocaleString('nl-NL')}\n\n`);

  let running = true;
  process.on('SIGINT', () => { running = false; log('Stoppen…'); });

  let i = 0;
  while (running) {
    const wav = join(tmp, `chunk-${i++}.wav`);
    try {
      await recordChunk(wav);
      const text = await transcribe(wav);
      await unlink(wav).catch(() => {});
      if (text) {
        const stamp = new Date().toLocaleTimeString('nl-NL');
        await appendFile(OUT_FILE, `**[${stamp}]** ${text}\n\n`);
        log(`+ ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
        if (DO_PUSH) await gitPush();
      }
    } catch (e) {
      log('Fout in ronde:', String((e && e.message) || e));
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  log('Live-brug gestopt.');
}

main().catch(e => { console.error(e); process.exit(1); });
