#!/usr/bin/env python3
"""Build the timed local narration track for the SentinelTwin demo video."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model


SAMPLE_RATE = 24_000
VIDEO_DURATION_SECONDS = 150.4
MODEL_ID = "mlx-community/Kokoro-82M-bf16"


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str


SEGMENTS = (
    Segment(
        0,
        15,
        "Sentinel Twin is a human supervised disaster response digital twin. "
        "It connects real satellite evidence, "
        "multi hazard simulations, and shared agent memory, so every response "
        "can learn from the one before it.",
    ),
    Segment(
        15,
        30,
        "I built it because emergency teams create valuable knowledge every time "
        "they act: what failed, what stayed open, and what actually helped. But "
        "most dashboards and artificial intelligence agents lose that context when "
        "the session ends.",
    ),
    Segment(
        30,
        50,
        "And disasters do not happen in isolation. A wildfire can affect roads, "
        "power, water, communications, and farmland at the same time. So Sentinel "
        "Twin keeps the evidence, assumptions, decisions, and outcomes connected "
        "in one loop: observe, reason within clear limits, and remember.",
    ),
    Segment(
        50,
        65,
        "Here you can see the architecture. Amazon Web Services handles secure "
        "access through A P I Gateway, serverless functions with Lambda, reasoning with "
        "Bedrock, and versioned S three evidence. "
        "Cockroach D B keeps the operational state and vector memory together, so "
        "every recalled lesson stays tied to its source.",
    ),
    Segment(
        65,
        70,
        "The command center brings risk, agents, guardrails, and memory into one view.",
    ),
    Segment(
        70,
        80,
        "For real imagery, it only accepts approved Sentinel Two, Level Two A "
        "data, then verifies the private copy's signature, version, E tag, and hash "
        "before Bedrock.",
    ),
    Segment(
        80,
        90,
        "For this recording, I switch to the built in tile. The dashboard clearly "
        "labels it synthetic, says no satellite pixels were analyzed, and reports "
        "no durable database write.",
    ),
    Segment(
        90,
        95,
        "From here, the lab supports wildfire, earthquakes, compound events, and agriculture.",
    ),
    Segment(
        95,
        105,
        "Agriculture is evidence gated. It will not claim a real crop assessment "
        "until stored Sentinel Two satellite evidence exists. Weather and irrigation "
        "inputs stay labeled assumptions rather than made up facts.",
    ),
    Segment(
        105,
        115,
        "Here, the first wildfire run retrieves shared memory, creates a bounded "
        "plan, and learns a new memory. Because this is the local demo, that write "
        "is correctly labeled ephemeral.",
    ),
    Segment(
        115,
        130,
        "Then I run it again. The memory count rises from two to three, and the "
        "result cites the exact memory created by the first run. So the second "
        "decision is actually using the first decision's outcome, not showing a "
        "retrieval sidebar.",
    ),
    Segment(
        130,
        145,
        "Here you can see the five agent workflow: assessor, retriever, simulator, "
        "planner, and commander. In deployed mode, Cockroach D B provides durable "
        "vector recall, while Amazon Web Services provides secure execution, "
        "evidence storage, model inference, tracing, and alarms.",
    ),
    Segment(
        145,
        150,
        "And that is Sentinel Twin: an audit trail, safer decisions, and learning with every response. Thank you.",
    ),
)


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def trim_silence(audio: np.ndarray, threshold: float = 0.001) -> np.ndarray:
    active = np.flatnonzero(np.abs(audio) >= threshold)
    if active.size == 0:
        return audio
    margin = int(0.025 * SAMPLE_RATE)
    start = max(0, int(active[0]) - margin)
    end = min(audio.size, int(active[-1]) + margin + 1)
    return audio[start:end]


def fade(audio: np.ndarray, seconds: float = 0.02) -> np.ndarray:
    frames = min(int(seconds * SAMPLE_RATE), audio.size // 2)
    if frames <= 0:
        return audio
    result = audio.copy()
    ramp = np.linspace(0, 1, frames, dtype=np.float32)
    result[:frames] *= ramp
    result[-frames:] *= ramp[::-1]
    return result


def generate_segment(model, text: str, speed: float) -> np.ndarray:
    chunks = [np.asarray(result.audio, dtype=np.float32) for result in model.generate(
        text=text,
        voice="am_michael",
        speed=speed,
        lang_code="a",
    )]
    if not chunks:
        raise RuntimeError("The narration model returned no audio")
    return trim_silence(np.concatenate(chunks))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("output/playwright/voice-work/narration"),
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    model = load_model(MODEL_ID)
    final_parts: list[np.ndarray] = []
    manifest: list[dict[str, float | int | str]] = []

    for index, segment in enumerate(SEGMENTS):
        target_seconds = segment.end - segment.start
        lead_seconds = 0.12 if target_seconds <= 5 else 0.22
        end_margin_seconds = 0.16 if target_seconds <= 5 else 0.25
        available_seconds = target_seconds - lead_seconds - end_margin_seconds
        target_wpm = word_count(segment.text) * 60 / available_seconds
        speed = min(1.35, max(0.96, target_wpm / 124))

        for _ in range(3):
            audio = generate_segment(model, segment.text, speed)
            raw_seconds = audio.size / SAMPLE_RATE
            if raw_seconds <= available_seconds:
                break
            speed = min(1.48, speed * (raw_seconds / available_seconds) * 1.025)
        else:
            raise RuntimeError(f"Segment {index + 1} does not fit its visual window")

        # Avoid a rushed sentence followed by a conspicuously long silent tail.
        # Regenerate only clearly short segments at a calmer model-native speed.
        if raw_seconds < available_seconds * 0.91 and speed > 0.96:
            calmer_speed = max(
                0.96,
                speed * raw_seconds / (available_seconds * 0.93),
            )
            for _ in range(3):
                calmer_audio = generate_segment(model, segment.text, calmer_speed)
                if calmer_audio.size / SAMPLE_RATE <= available_seconds:
                    audio = calmer_audio
                    speed = calmer_speed
                    raw_seconds = audio.size / SAMPLE_RATE
                    break
                calmer_speed = (calmer_speed + speed) / 2

        peak = float(np.max(np.abs(audio)))
        if peak > 0:
            audio = audio * (0.72 / peak)
        audio = fade(audio)

        target_frames = round(target_seconds * SAMPLE_RATE)
        lead_frames = round(lead_seconds * SAMPLE_RATE)
        tail_frames = target_frames - lead_frames - audio.size
        if tail_frames < 0:
            raise RuntimeError(f"Segment {index + 1} overran after timing")
        timed = np.concatenate(
            (
                np.zeros(lead_frames, dtype=np.float32),
                audio,
                np.zeros(tail_frames, dtype=np.float32),
            )
        )

        stem = f"segment-{index + 1:02d}"
        sf.write(args.output_dir / f"{stem}-raw.wav", audio, SAMPLE_RATE)
        sf.write(args.output_dir / f"{stem}-timed.wav", timed, SAMPLE_RATE)
        final_parts.append(timed)
        manifest.append(
            {
                "segment": index + 1,
                "start": segment.start,
                "end": segment.end,
                "words": word_count(segment.text),
                "speed": round(speed, 3),
                "raw_duration": round(audio.size / SAMPLE_RATE, 3),
                "window_duration": target_seconds,
                "text": segment.text,
            }
        )
        print(
            f"{stem}: {audio.size / SAMPLE_RATE:.2f}s in {target_seconds:.2f}s "
            f"at {speed:.3f}x"
        )

    final_audio = np.concatenate(final_parts)
    final_frames = round(VIDEO_DURATION_SECONDS * SAMPLE_RATE)
    if final_audio.size < final_frames:
        final_audio = np.pad(final_audio, (0, final_frames - final_audio.size))
    elif final_audio.size > final_frames:
        final_audio = final_audio[:final_frames]

    sf.write(args.output_dir / "sentineltwin-narration-raw.wav", final_audio, SAMPLE_RATE)
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
