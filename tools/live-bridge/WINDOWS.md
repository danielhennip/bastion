# Live-brug op Windows — stap voor stap

Doel: je Windows-laptop vangt tijdens de vergadering het geluid van de
Notubiz-livestream op, zet het om naar tekst en pusht dat naar de repo. Claude
leest mee, maakt AI-aantekeningen, en het dashboard toont beide live.

---

## Snelste manier: de bureaublad-knop (1 klik)

Dubbelklik **één keer** op `MAAK-BUREAUBLAD-KNOP.cmd` (hoofdmap van de
repo). Daarna staat er een knop **"Zuidplas LIVE"** op je bureaublad:
dubbelklik daarop en alles gaat vanzelf aan — stream openen, transcriberen,
en na 4 uur netjes stoppen. Handmatig eerder stoppen: Ctrl + C in het
zwarte venster.

---

## Elke vergadering: zó start je (2 stappen)

1. Open de vergadering in je browser en start de uitzending, **geluid aan**
   (bijv. via https://zuidplas.notubiz.nl).
2. Dubbelklik **`START-LIVE.cmd`** in de map van de repo (bijv.
   `C:\Windows\system32\bastion`). Dat is alles — het venster werkt eerst de
   code bij en begint dan met opnemen en transcriberen.

Stoppen: **Ctrl + C** in dat venster (of het venster sluiten).

> **Stil opnemen (geen geluid in de kamer):** steek een koptelefoon of
> oortje in de laptop en leg die neer. Stereo Mix vangt af wat de laptop
> afspeelt — dat werkt ook als niemand het hoort. Zet het volume wel op
> een normaal niveau (niet gedempt), anders neemt Stereo Mix stilte op.

Wil je dat Claude live meeschrijft? Open een Claude Code-sessie in deze repo
en zeg: **"start meekijken"** — Claude volgt dan het transcript en vult de
AI-aantekeningen op het dashboard.

> Geen PowerShell-instellingen (`Set-ExecutionPolicy`) meer nodig:
> `START-LIVE.cmd` is een gewoon batchbestand, daar geldt dat niet voor.

---

## Volautomatisch (laptop hoeft alleen aan te staan)

Wil je niet eens meer hoeven klikken? Dubbelklik **één keer** op
**`INSTALL-AUTOSTART.cmd`** (in de hoofdmap). Vanaf dan start de laptop
elke **dinsdag om 19:55** zelf:

1. de browser met de stream (autoplay aangezet),
2. de transcriptie (`AUTO-LIVE.cmd`),
3. en stopt vanzelf na 4 uur (instelbaar via `MAX_MINUTES` in `.env`).

Voorwaarden: laptop aan + jij ingelogd. Andere dag of tijd? In PowerShell:
`powershell -ExecutionPolicy Bypass -File tools\live-bridge\register-autostart.ps1 -Day Monday -Time 19:25`
Uitzetten: zelfde script met `-Remove`.

De knop/autostart opent de stream in je **standaardbrowser**. Andere browser
afdwingen? Zet in `.env` bijv. `LIVE_BROWSER=chrome` (of `msedge`/`brave`).

Tip: zet in `.env` een regel `LIVE_URL=https://zuidplas.notubiz.nl/vergadering/…`
met de juiste vergadering-URL zodra die bekend is; zonder die regel opent de
autostart de algemene Notubiz-portal. Controleer bij de eerste automatische
run even of de speler daar echt vanzelf begint te spelen.

---

## Eenmalig instellen (op deze laptop al gebeurd ✅)

1. **Software**: Git, ffmpeg, Node.js, Python 3 — geïnstalleerd via `winget`.
2. **Transcriptie-engine (gratis, lokaal)**: faster-whisper — wordt door de
   startknoppen zelf geïnstalleerd als hij ontbreekt. Bij de eerste run test
   de pc zichzelf en kiest automatisch het beste model dat hij live kan
   bijhouden (small of medium; het eerste blok duurt daardoor wat langer —
   modeldownload van honderden MB's, eenmalig).
3. **Stereo Mix** aangezet: Geluidsinstellingen → tab Opnemen → rechtsklik →
   "Uitgeschakelde apparaten weergeven" → Stereo Mix → Inschakelen.
   - Geen Stereo Mix op jouw pc? Installeer gratis VB-CABLE
     (https://vb-audio.com/Cable/) en gebruik `CABLE Output` als invoer.
4. **`.env`** in `tools\live-bridge\.env`:

   ```
   FFMPEG_FORMAT=dshow
   FFMPEG_INPUT=audio=Stereo Mix (Realtek(R) Audio)
   LOCAL_WHISPER=1
   WHISPER_MODEL_SIZE=auto
   PUSH=1
   ```

   (`auto` = de pc kiest zelf het beste model; een oude regel met `base`
   wordt door de startknoppen automatisch omgezet naar `auto`.)

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
- **"Transcriptie loopt X blokken achter"** → meestal loopt dit tijdens
  stiltes vanzelf weer in. Blijft het oplopen: verwijder
  `tools\live-bridge\.model-choice.json` en start opnieuw — de pc kiest dan
  opnieuw (en conservatiever) een model.
- **Slechte tekstkwaliteit** → controleer dat `.env` `WHISPER_MODEL_SIZE=auto`
  bevat en verwijder `.model-choice.json` zodat de keuzetest opnieuw draait.
- **Lege of onzinnige tekst** → controleer dat de stream écht hoorbaar
  speelt (volume aan, juiste uitvoerapparaat) en dat er gesproken wordt.
- **Niets in het dashboard** → kijk of het venster "✓ Transcript gepusht"
  meldt. Zo niet: zie het push-punt hierboven.
