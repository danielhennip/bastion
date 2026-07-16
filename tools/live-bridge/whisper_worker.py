# Zuidplas Live-brug — transcriptie-werker (v3).
#
# Draait naast transcribe.mjs en doet uitsluitend: WAV-blokken omzetten naar
# tekst, zo goed en zo snel mogelijk, in het Nederlands.
#
# Waarom dit bestand bestaat: de oude aanpak startte voor elk blok van 30s
# een nieuw whisper-proces dat het model opnieuw moest laden — traag en met
# slecht resultaat. Deze werker laadt het model ÉÉN keer (faster-whisper,
# 4x sneller dan openai-whisper) en verwerkt daarna blok na blok, met
# stiltefilter (VAD) en raadscontext voor betere Nederlandse zinnen.
#
# Protocol met transcribe.mjs:
#   - Node zet voltooide opnames als  <werkmap>/chunk-000123.wav
#   - Deze werker pakt ze op volgorde, schrijft chunk-000123.txt (UTF-8)
#     en verwijdert de wav. Regel 1 van de txt is de tekst (kan leeg zijn).
#   - Bestand STOP in de werkmap = netjes afsluiten.
#
# Modelkeuze (--model auto, aanbevolen):
#   1e run: benchmark op het eerste echte audioblok. Start met 'small'
#   (goede Nederlandse kwaliteit). Ruim sneller dan realtime? Probeer
#   'medium' (nog beter). Te traag? Zak naar 'base'. De keuze wordt
#   opgeslagen in .model-choice.json zodat volgende keren direct goed staan.

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path

INITIAL_PROMPT = (
    "Vergadering van de gemeenteraad van Zuidplas. De voorzitter geeft het "
    "woord aan raadsleden en wethouders. Onderwerpen: moties, amendementen, "
    "begroting, zomernota, woningbouw, bereikbaarheid, Nieuwerkerk aan den "
    "IJssel, Zevenhuizen, Moordrecht, Moerkapelle."
)

HERE = Path(__file__).resolve().parent
CHOICE_FILE = HERE / ".model-choice.json"


def log(*a):
    print(time.strftime("%H:%M:%S"), "[worker]", *a, flush=True)


def load_model(name, threads):
    from faster_whisper import WhisperModel
    log(f"Model '{name}' laden… (eerste keer = downloaden, kan even duren)")
    t0 = time.time()
    model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)
    log(f"Model '{name}' geladen in {time.time() - t0:.0f}s.")
    return model


def transcribe_file(model, wav_path):
    segments, info = model.transcribe(
        str(wav_path),
        language="nl",
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt=INITIAL_PROMPT,
        condition_on_previous_text=True,
        beam_size=5,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, getattr(info, "duration", 0.0) or 0.0


def wav_duration_seconds(path):
    # 16kHz mono 16-bit: 32000 bytes per seconde, 44 bytes header.
    try:
        return max(0.0, (os.path.getsize(path) - 44) / 32000.0)
    except OSError:
        return 0.0


def pick_model(requested, watch_dir, threads):
    """Bepaal welk model we draaien. 'auto' benchmarkt op het eerste blok."""
    if requested != "auto":
        return load_model(requested, threads), requested

    if CHOICE_FILE.exists():
        try:
            choice = json.loads(CHOICE_FILE.read_text())["model"]
            log(f"Eerder gekozen model: {choice} (verwijder .model-choice.json om opnieuw te testen)")
            return load_model(choice, threads), choice
        except Exception:
            pass

    # Wacht op het eerste echte audioblok om op te benchmarken.
    log("Automatische modelkeuze: wachten op eerste audioblok voor snelheidstest…")
    first = wait_for_chunk(watch_dir)
    if first is None:
        return load_model("small", threads), "small"

    order = ["small", "medium"]  # start goed, upgrade als de pc het aankan
    chosen, model = None, None
    for name in order:
        try:
            m = load_model(name, threads)
        except Exception as e:
            log(f"Model {name} laden mislukte ({e}); ik hou de vorige keuze aan.")
            break
        t0 = time.time()
        text, audio_dur = transcribe_file(m, first)
        took = max(0.1, time.time() - t0)
        audio_dur = audio_dur or wav_duration_seconds(first)
        speed = audio_dur / took
        log(f"Benchmark {name}: {audio_dur:.0f}s audio in {took:.0f}s → {speed:.1f}x realtime")
        if speed >= 1.3:  # houdt het live bij, met marge
            chosen, model = name, m
            if name == "small" and speed >= 3.0:
                continue  # ruim snel genoeg: probeer medium (betere kwaliteit)
            break
        else:
            if chosen:  # vorige (kleinere) keuze was wel snel genoeg
                model = load_model(chosen, threads)
            else:
                log("small is te traag voor live gebruik op deze pc; terug naar base.")
                chosen = "base"
                model = load_model("base", threads)
            break

    if model is None:  # alles mislukt → veiligste keuze
        chosen = "base"
        model = load_model(chosen, threads)

    CHOICE_FILE.write_text(json.dumps({"model": chosen, "testedAt": time.strftime("%Y-%m-%dT%H:%M:%S")}))
    log(f"Gekozen model: {chosen} (opgeslagen voor volgende keren)")

    # Het benchmark-blok meteen als resultaat wegschrijven (niets weggooien).
    write_result(first, transcribe_file(model, first)[0] if chosen else "")
    return model, chosen


def wait_for_chunk(watch_dir, timeout=None):
    start = time.time()
    while True:
        if (watch_dir / "STOP").exists():
            return None
        wavs = sorted(watch_dir.glob("chunk-*.wav"))
        if wavs:
            return wavs[0]
        if timeout and time.time() - start > timeout:
            return None
        time.sleep(1.0)


def write_result(wav_path, text):
    txt_path = wav_path.with_suffix(".txt")
    tmp_path = txt_path.with_suffix(".txt.tmp")
    tmp_path.write_text((text or "") + "\n", encoding="utf-8")
    os.replace(tmp_path, txt_path)  # atomair: node ziet nooit een half bestand
    try:
        wav_path.unlink()
    except OSError:
        pass


def main():
    # Ctrl+C gaat naar het hele consolevenster (ook op Windows). De werker
    # negeert dat signaal: hij werkt de wachtrij af en stopt pas netjes als
    # transcribe.mjs het STOP-bestand neerzet. Zo raakt bij het stoppen
    # nooit het staartje van de vergadering kwijt.
    try:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    except (ValueError, OSError):
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="werkmap met chunk-*.wav")
    ap.add_argument("--model", default="auto")
    args = ap.parse_args()

    watch_dir = Path(args.dir)
    threads = max(2, (os.cpu_count() or 4))

    try:
        model, chosen = pick_model(args.model, watch_dir, threads)
    except ImportError:
        log("FOUT: faster-whisper is niet geïnstalleerd (pip install faster-whisper).")
        sys.exit(3)

    print(f"READY {chosen}", flush=True)  # signaal voor transcribe.mjs

    while True:
        wav = wait_for_chunk(watch_dir)
        if wav is None:
            log("STOP-signaal ontvangen; werker sluit af.")
            break
        t0 = time.time()
        try:
            text, audio_dur = transcribe_file(model, wav)
        except Exception as e:
            log(f"Blok {wav.name} mislukt: {e}")
            text, audio_dur = "", 0.0
        took = time.time() - t0
        dur = audio_dur or wav_duration_seconds(wav)
        log(f"{wav.name}: {dur:.0f}s audio → {took:.0f}s ({(dur / max(took, 0.1)):.1f}x)")
        write_result(wav, text)


if __name__ == "__main__":
    main()
