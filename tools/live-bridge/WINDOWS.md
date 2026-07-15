# Live-brug op Windows — stap voor stap

Doel: je Windows-laptop vangt tijdens de vergadering het geluid van de
Notubiz-livestream op, zet het om naar tekst en pusht dat naar de repo. Claude
leest mee, maakt AI-aantekeningen, en het dashboard toont beide live.

---

## Elke vergadering: zó start je (2 stappen)

1. Open de vergadering in je browser en start de uitzending, **geluid aan**
   (bijv. via https://zuidplas.notubiz.nl).
2. Dubbelklik **`START-LIVE.cmd`** in de map van de repo (bijv.
   `C:\Windows\system32\bastion`). Dat is alles — het venster werkt eerst de
   code bij en begint dan met opnemen en transcriberen.

Stoppen: **Ctrl + C** in dat venster (of het venster sluiten).

Wil je dat Claude live meeschrijft? Open een Claude Code-sessie in deze repo
en zeg: **"start meekijken"** — Claude volgt dan het transcript en vult de
AI-aantekeningen op het dashboard.

> Geen PowerShell-instellingen (`Set-ExecutionPolicy`) meer nodig:
> `START-LIVE.cmd` is een gewoon batchbestand, daar geldt dat niet voor.

---

## Eenmalig instellen (op deze laptop al gebeurd ✅)

1. **Software**: Git, ffmpeg, Node.js, Python 3 — geïnstalleerd via `winget`.
2. **Whisper (gratis, lokaal)**: `pip install openai-whisper` — gedaan.
3. **Stereo Mix** aangezet: Geluidsinstellingen → tab Opnemen → rechtsklik →
   "Uitgeschakelde apparaten weergeven" → Stereo Mix → Inschakelen.
   - Geen Stereo Mix op jouw pc? Installeer gratis VB-CABLE
     (https://vb-audio.com/Cable/) en gebruik `CABLE Output` als invoer.
4. **`.env`** in `tools\live-bridge\.env`:

   ```
   FFMPEG_FORMAT=dshow
   FFMPEG_INPUT=audio=Stereo Mix (Realtek(R) Audio)
   LOCAL_WHISPER=1
   WHISPER_MODEL_SIZE=base
   PUSH=1
   ```

5. **GitHub-login (één keer)**: bij de eerste push opent Windows een
   browservenster om in te loggen bij GitHub. Daarna onthoudt de laptop het.
   Testen kan los met: PowerShell → `cd` naar de repo-map → `git push`.

---

## Problemen oplossen

- **Groot kader "GIT PUSH MISLUKT" in het venster** → volg de instructie in
  dat kader: één keer `git push` in een los venster en inloggen via de
  browser. Het transcript gaat lokaal gewoon door, er raakt niets kwijt.
- **ffmpeg-fout bij start** → apparaatnaam in `FFMPEG_INPUT` klopt niet
  exact, of Stereo Mix staat uit/op mute. Naam opzoeken:
  `ffmpeg -hide_banner -list_devices true -f dshow -i dummy`
- **"Transcriptie loopt X blokken achter"** → je pc kan het model niet
  bijbenen. Zet in `.env`: `WHISPER_MODEL_SIZE=tiny` (sneller) — of juist
  `small` als je pc snel genoeg is en je betere kwaliteit wilt.
- **Lege of onzinnige tekst** → controleer dat de stream écht hoorbaar
  speelt (volume aan, juiste uitvoerapparaat) en dat er gesproken wordt.
- **Niets in het dashboard** → kijk of het venster "✓ Transcript gepusht"
  meldt. Zo niet: zie het push-punt hierboven.
