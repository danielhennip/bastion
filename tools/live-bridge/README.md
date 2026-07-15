# Zuidplas Live-brug 🎙️→🤖

Deze tool laat **Claude (de AI) de live raadsvergadering meekrijgen**, ook al
blokkeert Notubiz alle geautomatiseerde toegang.

## Waarom is dit nodig?

De vergadering staat op `zuidplas.notubiz.nl`, achter Cloudflare-botbescherming.
Getest en bevestigd: elke geautomatiseerde toegang vanaf een datacenter-IP
(Claude's omgeving, GitHub-servers, kale scrapers) krijgt **HTTP 403 – "you have
been blocked"**, óók met een echte headless browser. Alleen een gewoon apparaat
op een thuis-/kantoor-IP met een echte browser — **jouw computer** — komt erdoor.

Daarom draait deze brug **bij jou lokaal**. Ze doet wat Claude zelf niet kan:
1. Ze speelt/ontvangt de livestream (jouw IP komt door Cloudflare).
2. Ze neemt het geluid op en zet het met spraakherkenning om naar tekst.
3. Ze schrijft een doorlopend transcript naar `data/zuidplas-live.md` en pusht
   dat naar de repo.

Claude leest dat bestand en kan zo de vergadering **live volgen, samenvatten en
vragen beantwoorden** — zonder de beveiliging van Notubiz te omzeilen (jij bent
een gewone, gemachtigde kijker).

## Wat je nodig hebt

- **Node.js 18+**
- **ffmpeg** (audio-opname): https://ffmpeg.org/download.html
- Eén transcriptie-optie:
  - **Lokaal & gratis:** [`whisper.cpp`](https://github.com/ggerganov/whisper.cpp)
    met een Nederlands model (`ggml-medium.bin` of `ggml-large-v3.bin`), **of**
  - **API:** een OpenAI-sleutel (`OPENAI_API_KEY`) voor `whisper-1` /
    `gpt-4o-transcribe`.

## Snelstart

```bash
cd tools/live-bridge
npm install

# 1) Zet de audiobron goed (zie "Audio opvangen" hieronder).
# 2) Start de brug tijdens de vergadering:

# Optie A — lokaal whisper.cpp:
WHISPER_CPP=/pad/naar/whisper.cpp/main \
WHISPER_MODEL=/pad/naar/ggml-medium.bin \
node transcribe.mjs

# Optie B — OpenAI API:
OPENAI_API_KEY=sk-... node transcribe.mjs
```

De brug neemt in blokjes van 30s op, transcribeert, en voegt de tekst toe aan
`../../data/zuidplas-live.md`. Met `PUSH=1` commit + pusht ze ook automatisch,
zodat Claude het (bijna) live ziet.

## Audio opvangen

De brug neemt op wat er via je audio-uitvoer of microfoon binnenkomt. Kies de
juiste `ffmpeg`-invoer voor jouw systeem via de env-var `FFMPEG_INPUT`:

- **macOS** (met [BlackHole](https://existential.audio/blackhole/) of Soundflower als loopback):
  `FFMPEG_INPUT=":BlackHole 2ch"` en zet je systeemuitvoer op BlackHole.
- **Windows** (WASAPI loopback):
  `FFMPEG_INPUT="audio=Stereo Mix (Realtek Audio)"` (schakel "Stereo Mix" in bij
  geluidsinstellingen), of gebruik VB-CABLE.
- **Linux** (PulseAudio monitor):
  `FFMPEG_INPUT="default"` met `FFMPEG_FORMAT=pulse`, of de `.monitor`-bron van
  je uitvoerapparaat (`pactl list sources short`).

Laat de vergadering afspelen (open gewoon
`https://zuidplas.notubiz.nl/vergadering/1391079` in je browser) en de brug
transcribeert wat je hoort.

## Alternatief zonder audio: agenda/onderwerp doorsturen

Wil je alleen dat Claude de **agenda en het huidige onderwerp** meekrijgt (geen
volledige transcriptie)? Gebruik dan `capture-agenda.user.js` (bookmarklet /
Tampermonkey-script). Dat leest de zichtbare tekst van de Notubiz-pagina in jouw
browser en kopieert die naar je klembord, zodat je het in de chat kunt plakken.

## Privacy & gebruik

Openbare raadsvergaderingen zijn openbaar; je bent een gemachtigde kijker. De
brug omzeilt geen beveiliging: ze gebruikt jouw normale toegang. Deel geen
besloten (niet-openbare) delen van vergaderingen.
