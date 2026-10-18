// SPDX-License-Identifier: MIT
// Folia audio mapping helpers shared by the native host and (for parity checks) the Kotlin side.
//
// Two responsibilities:
//   1) Shape(): Folia's gamma curve from usePlaybackVisualizerBridge.ts
//          process(v, boost) = (v/255)^boost * 255     -- v is a raw 0..255 byte-scale level
//   2) Paused/no-signal payload: Folia's "breath" fallback (folia-spec runtime-contracts §7.3)
//          breath = (sin(Date.now()/2000) + 1) * 20     -- 0..40, written to power + all 5 bands
//      with an EMPTY spectrum array; a separate `paused` flag comes from the player state.
//
// No dependencies, C# 5. Namespace SpwFolia.Audio.
using System;

namespace SpwFolia.Audio
{
    public static class FoliaAudioMapper
    {
        /// <summary>Folia gamma: (v/255)^boost * 255. v may be any 0..255 level (float fine).</summary>
        public static double Shape(double v, double boost)
        {
            if (v <= 0.0) return 0.0;
            if (v >= 255.0) return 255.0;
            return Math.Pow(v / 255.0, boost) * 255.0;
        }

        /// <summary>Breath oscillation 0..40 for the current wall-clock time (ms since Unix epoch).</summary>
        public static float Breath(long nowMs)
        {
            double phase = (double)nowMs / 2000.0;
            return (float)((Math.Sin(phase) + 1.0) * 20.0);
        }

        /// <summary>
        /// Paused/no-signal payload: power + all five bands get the breath value, spectrum must be an
        /// empty array on the wire. `bands` is length 5 in protocol order (bass, lowMid, mid, vocal, treble).
        /// </summary>
        public static void PausedPayload(long nowMs, out float power, out float[] bands)
        {
            float breath = Breath(nowMs);
            power = breath;
            bands = new float[] { breath, breath, breath, breath, breath };
        }

        /// <summary>Convenience: paused power only (all bands share the same value).</summary>
        public static float PausedPower(long nowMs)
        {
            return Breath(nowMs);
        }
    }
}
