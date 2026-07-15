---
name: zuidplas-meekijken
description: Volg live een Zuidplas-raadsvergadering mee — lees het binnenkomende transcript, maak doorlopend AI-aantekeningen (samenvatting, besluiten, stemmingen, toezeggingen) en push die naar de repo zodat het dashboard ze toont. Gebruik wanneer de gebruiker vraagt om "meekijken", "meelezen", "de vergadering volgen" of "aantekeningen maken" bij een raadsvergadering.
---

# Zuidplas meekijken — live AI-aantekeningen

## Context

De laptop van de gebruiker draait tijdens de vergadering `START-LIVE.cmd`
(repo-root). Die pusht elke ~90s nieuwe transcriptregels naar
`data/zuidplas-live.md` op branch `claude/read-other-chat-3rr64o`, plus een
statusbestand `data/zuidplas-live-status.json`. Jouw taak: dat transcript
doorlopend omzetten in bruikbare aantekeningen in `data/zuidplas-notes.md`.

## Werkwijze

1. **Start**: `git fetch origin claude/read-other-chat-3rr64o` en checkout
   die branch (of werk erop verder als je er al op staat). Lees
   `data/zuidplas.json` (agenda) als achtergrond.

2. **Lus** — herhaal tot de vergadering voorbij is:
   a. `git pull --rebase origin claude/read-other-chat-3rr64o`.
   b. Lees `data/zuidplas-notes.md`; de marker `<!-- transcript-offset: N -->`
      geeft aan tot welke byte van `data/zuidplas-live.md` je al verwerkt hebt.
   c. Lees `data/zuidplas-live.md` vanaf die offset. Niets nieuws? Sla deze
      ronde over (geen commit).
   d. Verwerk de nieuwe tekst in de aantekeningen (structuur hieronder).
      Werk bestaande secties bij in plaats van alles opnieuw te schrijven.
      Update beide markers: `bijgewerkt` (ISO-tijd nu) en `transcript-offset`
      (nieuwe bytelengte van zuidplas-live.md).
   e. Commit (`docs: AI-aantekeningen vergadering bijgewerkt`) en
      `git push origin HEAD`. Bij een push-conflict: pull --rebase en opnieuw.
   f. Wacht ~2–3 minuten (send_later of ScheduleWakeup — nooit Bash sleep)
      en ga naar (a).

3. **Einde**: als `zuidplas-live-status.json` `running: false` meldt, of er
   > 15 minuten geen nieuw transcript is: schrijf een eindsamenvatting
   bovenaan de aantekeningen, push, en meld de gebruiker kort de belangrijkste
   uitkomsten. Stop de lus.

## Structuur van data/zuidplas-notes.md

```markdown
<!-- bijgewerkt: 2026-09-08T20:14:00Z -->
<!-- transcript-offset: 48213 -->

# AI-aantekeningen — [titel vergadering] ([datum])

## Nu besproken
Eén à twee zinnen: waar gaat het NU over.

## Samenvatting tot nu toe
Doorlopend bijgewerkte samenvatting per agendapunt (### kopjes).

## Besluiten & stemmingen
- ✅/❌ [tijd] Besluit + uitslag indien genoemd.

## Toezeggingen & actiepunten
- [tijd] Wie zegde wat toe.

## Opvallend
Citaten of momenten die eruit sprongen.
```

## Kwaliteitsregels

- Het transcript is machinaal (Whisper) en bevat fouten; corrigeer stilzwijgend
  waarschijnlijke misherkenning, maar verzin nooit besluiten of cijfers die er
  niet staan. Bij twijfel: "(onduidelijk in transcript)".
- Schrijf in het Nederlands, compact en feitelijk. Tijden overnemen uit de
  `**[HH:MM:SS]**`-stempels.
- Commit alléén `data/zuidplas-notes.md` — nooit het transcript zelf wijzigen
  (dat is van de laptop-brug; jouw pull --rebase voorkomt conflicten).
