# Live-brug op Windows — stap voor stap

Doel: je Windows-laptop vangt tijdens de vergadering het geluid van de
Notubiz-livestream op, zet het om naar tekst en pusht dat naar de repo. Claude
leest die tekst — ook in je chat op de telefoon.

Je hoeft dit maar **één keer** in te stellen. Daarna is het: stream afspelen →
brug starten.

---

## Snelste weg: twee scripts

De repo bevat twee kant-en-klare PowerShell-scripts, zodat je bijna niets
handmatig hoeft te doen.

```powershell
# 1) Repo ophalen
git clone https://github.com/danielhennip/bastion.git
cd bastion
git checkout claude/zuidplas-livestream-tool-kiz0jd
cd tools\live-bridge

# 2) Eénmalige installatie (installeert Node, ffmpeg, Git; vraagt je
#    OpenAI-sleutel en audiobron). Draai PowerShell als Administrator.
.\setup-windows.ps1

# 3) Tijdens de vergadering (stream speelt in je browser, geluid aan):
.\start-live.ps1
```

> Als PowerShell scripts blokkeert, sta ze eerst toe voor deze sessie:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

Werkt dat? Klaar. Wil je begrijpen wat er gebeurt of loopt iets mis, volg dan de
handmatige stappen hieronder.

---

## Eenmalig instellen

### 1. Node.js installeren
Download de LTS-versie van https://nodejs.org en installeer (klik door de wizard).
Controleer in **PowerShell**:
```powershell
node --version
```

### 2. ffmpeg installeren
Makkelijkste manier (PowerShell als Administrator):
```powershell
winget install Gyan.FFmpeg
```
Sluit PowerShell en open opnieuw. Controleer:
```powershell
ffmpeg -version
```

### 3. Geluid van de stream opvangbaar maken (Stereo Mix)
Windows kan het geluid dat je hoort teruglezen via "Stereo Mix":
1. Rechtsklik op het luidspreker-icoon → **Geluidsinstellingen** → **Meer
   geluidsinstellingen** → tab **Opnemen**.
2. Rechtsklik in de lijst → **Uitgeschakelde apparaten weergeven**.
3. Zie je **Stereo Mix**? Rechtsklik → **Inschakelen**.
   - Geen Stereo Mix? Installeer dan de gratis **VB-CABLE**
     (https://vb-audio.com/Cable/) en gebruik "CABLE Output" i.p.v. Stereo Mix.

Zoek de exacte apparaatnaam op:
```powershell
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
```
Noteer de naam precies zoals getoond, bijv. `Stereo Mix (Realtek(R) Audio)`.

### 4. De repo op je laptop zetten
Installeer Git (https://git-scm.com) en clone je repo (voorbeeld):
```powershell
git clone https://github.com/danielhennip/bastion.git
cd bastion
git checkout claude/zuidplas-livestream-tool-kiz0jd
cd tools\live-bridge
npm install
```

### 5. Transcriptie-sleutel (aanrader op Windows: OpenAI)
Geen model-download nodig. Zet je sleutel klaar (vervang door je eigen):
```powershell
$env:OPENAI_API_KEY = "sk-...jouw-sleutel..."
```
(Gratis-lokaal met whisper.cpp kan ook — zie README.md — maar is meer werk.)

---

## Elke vergadering: starten

1. Open de vergadering in je browser en start de uitzending (geluid aan):
   `https://zuidplas.notubiz.nl/vergadering/1391079`
2. In PowerShell, vanuit de map `tools\live-bridge`:

```powershell
$env:FFMPEG_FORMAT = "dshow"
$env:FFMPEG_INPUT  = "audio=Stereo Mix (Realtek(R) Audio)"   # exact jouw naam uit stap 3
$env:OPENAI_API_KEY = "sk-...jouw-sleutel..."
$env:PUSH = "1"                                              # pusht transcript automatisch
node transcribe.mjs
```

Je ziet elke ~30 seconden een regel verschijnen. Het transcript loopt vol in
`data/zuidplas-live.md` en wordt gepusht. In het BASTION-dashboard verschijnt het
onder **Live transcript**, en ik kan het in de chat lezen en samenvatten.

Stoppen: druk **Ctrl + C** in PowerShell.

---

## Problemen oplossen

- **"Geen transcriptie-optie"** → `OPENAI_API_KEY` niet gezet in hetzelfde
  PowerShell-venster.
- **ffmpeg-fout / geen geluid** → apparaatnaam in `FFMPEG_INPUT` klopt niet
  exact; check stap 3 opnieuw. Of Stereo Mix staat op mute in de Opnemen-tab.
- **git push vraagt om inloggen** → log één keer in met je GitHub-account
  (of gebruik GitHub Desktop). Zonder push blijft het transcript lokaal; je
  kunt het dan handmatig in de chat plakken.
- **Niets in het dashboard** → het dashboard leest de branch die je gepusht
  hebt; ik kan het transcript sowieso rechtstreeks uit de repo lezen.
