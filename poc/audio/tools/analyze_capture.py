#!/usr/bin/env python3
"""Analyse JSONL captures from poc/audio/native/spw-folia-spectrum.exe.

Reads the harness stdout (one {"ev":"frame"} line per frame, optional {"ev":"beat"}
lines) plus the stderr stats line ({"ev":"stats",...}) and reports:

 * frame rate: fps, inter-frame interval mean/p95/max
 * latency: captureLatencyMs (audio buffer age at emit) mean/p95/max
 * emit cost: harness stats emitAvgUs/emitMaxUs, CPU %
 * spectrum mapping: per-frame peak FFT bin -> dominant tone run, expected vs measured
 * calibration: mean raw byte of the two 1 kHz segments -> measured dB delta vs expected
 * named bands: mean raw band values for each tone run, expected dominant band check
 * beats: count, IBI median/mean, downbeat count, strength range

Usage: python analyze_capture.py capture.jsonl [--label tones|kicks] [--save report.json]
"""
import json
import os
import statistics
import sys

EXPECTED_FPS = 60.0
SR = 48000
FFT = 2048
BIN_HZ = SR / 2.0 / 1024.0  # 23.4375 Hz at 48 kHz

# named band ranges in Hz (index: 0 bass, 1 lowMid, 2 mid, 3 vocal, 4 treble)
BAND_NAMES = ["bass", "lowMid", "mid", "vocal", "treble"]
BAND_JSON = ["rawBass", "rawLowMid", "rawMid", "rawVocal", "rawTreble"]
BAND_HZ = [(20, 150), (150, 400), (400, 1200), (1000, 3500), (3500, 12000)]

# expected dominant band for the tone segments in tones48.wav
TONE_SEGMENTS = [
    ("60Hz", 60.0, 0),
    ("300Hz", 300.0, 1),
    ("1kHz_lo", 1000.0, 2),
    ("1kHz_mid", 1000.0, 2),
    ("3kHz", 3000.0, 3),
    ("8kHz", 8000.0, 4),
]


def load(path):
    frames, beats, stats = [], [], None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            ev = obj.get("ev")
            if ev == "frame":
                frames.append(obj)
            elif ev == "beat":
                beats.append(obj)
            elif ev == "stats":
                stats = obj
    return frames, beats, stats


def pct(values, p):
    if not values:
        return 0.0
    v = sorted(values)
    idx = min(len(v) - 1, int(round((len(v) - 1) * p)))
    return v[idx]


def intervals(frames):
    out = []
    for a, b in zip(frames, frames[1:]):
        dt = b["mono"] - a["mono"]
        if 0.0 < dt < 250.0:
            out.append(dt)
    return out


def peak_bin(frame):
    spec = frame.get("spec") or []
    if not spec:
        return -1, 0
    best_i, best_v = 0, spec[0]
    for i in range(1, len(spec)):
        if spec[i] > best_v:
            best_i, best_v = i, spec[i]
    return best_i, best_v


def runs_from_peaks(frames, tolerance=2):
    """Group consecutive frames with near-identical peak bin into runs."""
    runs = []
    cur = None
    for f in frames:
        b, v = peak_bin(f)
        if v <= 0:
            cur = None
            continue
        fq = b * BIN_HZ
        if cur is not None and abs(b - cur["bin"]) <= tolerance:
            cur["frames"].append(f)
        else:
            cur = {"bin": b, "freq": fq, "frames": [f]}
            runs.append(cur)
    for r in runs:
        r["start"] = r["frames"][0]["mono"]
        r["end"] = r["frames"][-1]["mono"]
        r["dur"] = r["end"] - r["start"]
    return [r for r in runs if r["dur"] >= 250.0]


def mean_bands(run):
    n = len(run["frames"])
    return {
        name: sum(f.get(name, 0.0) for f in run["frames"]) / n
        for name in BAND_JSON
    }


def analyse_tones(frames):
    runs = runs_from_peaks(frames)
    out = {"runs": [], "calibration": None, "band_checks": []}
    for r in runs:
        bands = mean_bands(r)
        dom = max(BAND_JSON, key=lambda k: bands[k])
        out["runs"].append({
            "peakBin": r["bin"],
            "peakHz": round(r["freq"], 1),
            "durationMs": round(r["dur"], 0),
            "frames": len(r["frames"]),
            "meanRawBands": {k: round(bands[k], 2) for k in BAND_JSON},
            "dominantBand": dom,
        })
    # calibration: all frames whose spectrum peak is the 1 kHz bin (42 or 43 at 48 kHz), split into
    # a loud and a quiet cluster by the median peak-byte level (works whether both levels are in a
    # single alternating sweep or in separate captures). The peak bin byte is the right metric:
    # raw band means include -100 dBFS floor-clamped leakage bins and depend on system volume.
    khz = []
    for f in frames:
        spec = f.get("spec") or []
        if not spec:
            continue
        b, v = peak_bin(f)
        if abs(b - round(1000.0 / BIN_HZ)) <= 2 and v > 0:
            khz.append(v)
    if len(khz) >= 60:
        med = sorted(khz)[len(khz) // 2]
        loud = [v for v in khz if v > med]
        quiet = [v for v in khz if v <= med]
        loud_mean = sum(loud) / len(loud)
        quiet_mean = sum(quiet) / len(quiet)
        delta = loud_mean - quiet_mean
        db_delta = 10.5  # -40 dBFS vs -50.5 dBFS in the generated cal_sweep.wav
        expected = db_delta / 70.0 * 255.0  # AnalyserNode -100..-30 maps 70 dB -> 255
        out["calibration"] = {
            "loudPeakByte": round(loud_mean, 2),
            "quietPeakByte": round(quiet_mean, 2),
            "measuredDeltaBytes": round(delta, 2),
            "expectedDeltaBytes": round(expected, 2),
            "deltaErrorBytes": round(delta - expected, 2),
            "frames": {"loud": len(loud), "quiet": len(quiet)},
        }
    for r in runs:
        bands = mean_bands(r)
        dom = max(BAND_JSON, key=lambda k: bands[k])
        fq = r["freq"]
        expected_idx = None
        for i, (lo, hi) in enumerate(BAND_HZ):
            if lo <= fq < hi:
                expected_idx = i
                break
        out["band_checks"].append({
            "peakHz": round(fq, 1),
            "dominantBand": dom,
            "expectedBand": BAND_JSON[expected_idx] if expected_idx is not None else None,
            "ok": dom == BAND_JSON[expected_idx] if expected_idx is not None else None,
        })
    return out


def analyse_beats(frames, beats):
    ibis = []
    for a, b in zip(beats, beats[1:]):
        dt = b["mono"] - a["mono"]
        if 100.0 < dt < 2000.0:
            ibis.append(dt)
    strengths = [b.get("strength", 0.0) for b in beats]
    median_ibi = statistics.median(ibis) if ibis else 0.0
    return {
        "beatCount": len(beats),
        "downbeatCount": sum(1 for b in beats if b.get("downbeat")),
        "medianIbiMs": round(median_ibi, 1),
        "meanIbiMs": round(statistics.fmean(ibis), 1) if ibis else 0.0,
        "impliedBpm": round(60000.0 / median_ibi, 1) if median_ibi else 0.0,
        "strengthMin": round(min(strengths), 3) if strengths else 0.0,
        "strengthMax": round(max(strengths), 3) if strengths else 0.0,
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    label = "tones"
    save = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--label" and i + 1 < len(args):
            label = args[i + 1]
            i += 2
        elif args[i] == "--save" and i + 1 < len(args):
            save = args[i + 1]
            i += 2
        else:
            i += 1

    frames, beats, stats = load(path)
    if not frames:
        print(json.dumps({"error": "no frames in " + path}))
        return 1

    dts = intervals(frames)
    lat = [f["lat"] for f in frames if f.get("lat") is not None]
    report = {
        "capture": os.path.basename(path),
        "label": label,
        "frames": len(frames),
        "durationSec": round((frames[-1]["mono"] - frames[0]["mono"]) / 1000.0, 2),
        "fps": round(len(frames) / max(1e-9, (frames[-1]["mono"] - frames[0]["mono"]) / 1000.0), 2),
        "frameIntervalMs": {
            "mean": round(statistics.fmean(dts), 2) if dts else 0.0,
            "p95": round(pct(dts, 0.95), 2),
            "max": round(max(dts), 2) if dts else 0.0,
        },
        "silentFrames": sum(1 for f in frames if f.get("silent")),
        "captureLatencyMs": {
            "mean": round(statistics.fmean(lat), 2) if lat else 0.0,
            "p95": round(pct(lat, 0.95), 2),
            "max": round(max(lat), 2) if lat else 0.0,
        },
        "stats": stats,
        "beats": analyse_beats(frames, beats) if beats else None,
    }
    if label == "tones":
        report["tones"] = analyse_tones(frames)
    print(json.dumps(report, indent=2))
    if save:
        os.makedirs(os.path.dirname(save) or ".", exist_ok=True)
        with open(save, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
