import argparse
import asyncio
import json
import sys

import edge_tts


async def list_voices() -> None:
    voices = await edge_tts.list_voices()
    payload = [
        {
            "display_name": voice.get("FriendlyName") or voice.get("ShortName"),
            "gender": voice.get("Gender"),
            "locale": voice.get("Locale"),
            "name": voice.get("ShortName"),
        }
        for voice in voices
        if voice.get("ShortName")
    ]
    json.dump(payload, sys.stdout)


async def speak(
    text: str,
    voice: str,
    pitch: str,
    rate: str,
    output_file: str,
    timings_file: str | None = None,
) -> None:
    communicate = edge_tts.Communicate(
        text,
        voice,
        pitch=pitch,
        rate=rate,
        boundary="WordBoundary" if timings_file else "SentenceBoundary",
    )
    timings = []
    with open(output_file, "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                timings.append({
                    "durationMs": chunk["duration"] / 10_000,
                    "offsetMs": chunk["offset"] / 10_000,
                    "text": chunk["text"],
                })
    if timings_file:
        with open(timings_file, "w", encoding="utf-8") as target:
            json.dump(timings, target)


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("voices")

    speak_parser = subparsers.add_parser("speak")
    text_group = speak_parser.add_mutually_exclusive_group(required=True)
    text_group.add_argument("--text")
    text_group.add_argument("--text-file")
    speak_parser.add_argument("--voice", required=True)
    speak_parser.add_argument("--pitch", default="+0Hz")
    speak_parser.add_argument("--rate", default="+0%")
    speak_parser.add_argument("--output-file", required=True)
    speak_parser.add_argument("--timings-file")

    args = parser.parse_args()
    if args.command == "voices":
        asyncio.run(list_voices())
        return 0

    text = args.text
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as source:
            text = source.read()
    asyncio.run(speak(text, args.voice, args.pitch, args.rate, args.output_file, args.timings_file))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
