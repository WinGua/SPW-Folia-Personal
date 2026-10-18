#!/usr/bin/env python3
"""Generate known test audio for the spw-folia loopback spectrum harness.

Writes 48 kHz / 16-bit / stereo WAVs into poc/audio/measure/:

  tones48.wav  - 6 x 2 s steady tones (with 20 ms cosine fades):
                   60 Hz @ -14 dBFS, 300 Hz @ -14, 1 kHz @ -34, 1 kHz @ -44.5,
                   3 kHz @ -14, 8 kHz @ -14
                 Used for: FIFO/band mapping check, relative calibration check
                 (1 kHz -34 vs -44.5 dBFS => expected 10.46 dB = 38.1 spectrum bytes
                  at AnalyserNode minDecibels=-100/maxDecibels=-30, immune to unknown
                  system volume attenuation) and named-band dominance check.
  kicks48.wav  - 8 s, 120 BPM (16 kicks, 500 ms apart), 60 Hz decaying kick,
                 every 4th kick louder + 120 Hz click (downbeat heuristic probe).
  breathe.wav  - 12 s: 3 s silence, 3 s soft 220 Hz, 6 s silence (silence gate / breath).

Usage: python gen_test_audio.py [outdir]
"""
import math
import os
import struct
import sys
import wave

SR = 48000
CH = 2


def write_wav(path, samples):
    """samples: iterable of (l, r) floats in [-1, 1]."""
    with wave.open(path, "wb") as w:
        w.setnchannels(CH)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = bytearray()
        for l, r in samples:
            li = max(-32768, min(32767, int(round(l * 32767.0))))
            ri = max(-32768, min(32767, int(round(r * 32767.0))))
            buf += struct.pack("<hh", li, ri)
        w.writeframes(bytes(buf))


def fade(n, i, fade_samples=960):
    """20 ms cosine fade in/out at segment edges (960 samples @48k)."""
    g = 1.0
    if i < fade_samples:
        g = 0.5 - 0.5 * math.cos(math.pi * i / fade_samples)
    elif i > n - fade_samples:
        g = 0.5 - 0.5 * math.cos(math.pi * (n - i) / fade_samples)
    return g


def tone_segment(freq, amp, seconds, phase=0.0):
    n = int(round(seconds * SR))
    for i in range(n):
        v = amp * fade(n, i) * math.sin(2.0 * math.pi * freq * i / SR + phase)
        yield v, v


def gen_tones(path):
    segs = [
        (60.0, db_to_amp(-14.0), 2.0),
        (300.0, db_to_amp(-14.0), 2.0),
        (1000.0, db_to_amp(-34.0), 2.0),
        (1000.0, db_to_amp(-44.5), 2.0),
        (3000.0, db_to_amp(-14.0), 2.0),
        (8000.0, db_to_amp(-14.0), 2.0),
    ]
    gen = []
    for freq, amp, sec in segs:
        gen.append(tone_segment(freq, amp, sec))
    write_wav(path, concat(gen))
    print("wrote", path, "segments:", [(f, round(20 * math.log10(a), 2), s) for f, a, s in segs])


def gen_cal(outdir):
    """Single-tone calibration pair: same frequency, levels 10.5 dB apart (-34 / -44.5 dBFS).

    Captured separately (one playback at a time) so the delta between mean rawMid bytes is
    not polluted by segment-boundary effects. Expected delta = 10.5 dB / 70 dB * 255 = 38.25
    spectrum bytes (AnalyserNode minDecibels=-100 / maxDecibels=-30, invariant to system volume).
    """
    lo = os.path.join(outdir, "cal_lo.wav")
    hi = os.path.join(outdir, "cal_hi.wav")
    write_wav(lo, tone_segment(1000.0, db_to_amp(-34.0), 6.0))
    write_wav(hi, tone_segment(1000.0, db_to_amp(-44.5), 6.0))
    print("wrote", lo, "1 kHz @ -34 dBFS;", hi, "1 kHz @ -44.5 dBFS; expected delta 38.25 bytes")


def db_to_amp(db):
    return 10.0 ** (db / 20.0)


def concat(gens):
    for g in gens:
        for s in g:
            yield s


def gen_kicks(path):
    bpm = 120.0
    interval = 60.0 / bpm
    beats = 16
    n = int(round(beats * interval * SR))
    out = [(0.0, 0.0)] * n
    for b in range(beats):
        start = int(round(b * interval * SR))
        downbeat = (b % 4) == 0
        amp = 0.95 if downbeat else 0.6
        dur = int(round(0.14 * SR))
        for i in range(dur):
            if start + i >= n:
                break
            t = i / SR
            env = amp * math.exp(-t / 0.045) * fade(dur, i, 0)
            v = env * math.sin(2.0 * math.pi * 60.0 * t)
            if downbeat:
                v += 0.25 * amp * math.exp(-t / 0.012) * math.sin(2.0 * math.pi * 120.0 * t)
            l, r = out[start + i]
            out[start + i] = (l + v, r + v)
    clip = [(max(-1.0, min(1.0, l)), max(-1.0, min(1.0, r))) for l, r in out]
    write_wav(path, clip)
    print("wrote", path, "beats:", beats, "bpm:", bpm, "downbeats:", beats // 4)


def gen_breath(path):
    gen = [
        silence(3.0),
        tone_segment(220.0, db_to_amp(-20.0), 3.0),
        silence(6.0),
    ]
    write_wav(path, concat(gen))
    print("wrote", path)


def gen_cal_sweep(path):
    """Alternating 1 kHz levels with silence gaps, so the capture splits into two edge-free runs.

    -40 dBFS vs -50.5 dBFS => 10.5 dB => 10.5/70*255 = 38.25 expected spectrum bytes.
    Levels are deliberately below the AnalyserNode maximum (-30 dBFS) so that a system render
    chain with several dB of gain cannot clip the louder segment (clipping would bias the delta).
    """
    gen = []
    for _ in range(3):
        gen.append(tone_segment(1000.0, db_to_amp(-40.0), 2.0))
        gen.append(silence(0.5))
        gen.append(tone_segment(1000.0, db_to_amp(-50.5), 2.0))
        gen.append(silence(0.5))
    write_wav(path, concat(gen))
    print("wrote", path, "alternating 1 kHz -40/-50.5 dBFS, expected delta 38.25 bytes")


def silence(seconds):
    n = int(round(seconds * SR))
    for _ in range(n):
        yield 0.0, 0.0


def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "measure")
    outdir = os.path.abspath(outdir)
    os.makedirs(outdir, exist_ok=True)
    gen_tones(os.path.join(outdir, "tones48.wav"))
    gen_kicks(os.path.join(outdir, "kicks48.wav"))
    gen_cal(outdir)
    gen_cal_sweep(os.path.join(outdir, "cal_sweep.wav"))
    gen_breath(os.path.join(outdir, "breathe.wav"))


if __name__ == "__main__":
    main()
