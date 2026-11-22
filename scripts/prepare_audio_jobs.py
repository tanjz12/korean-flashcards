#!/usr/bin/env python3

import csv
import json
from pathlib import Path

INPUT = Path("data/cards_enriched.csv")
OUTPUT = Path("data/generated/audio_jobs.jsonl")

VOICES = [
    "tts_voice_a",
    "tts_voice_b",
    "tts_voice_c",
]

REQUIRED_COLUMNS = {
    "card_id",
    "topik_level",
    "hangul",
    "example_ko",
}


def main():
    if not INPUT.exists():
        raise SystemExit(f"Missing input file: {INPUT}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    seen_ids = set()
    job_count = 0

    with INPUT.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])

        if missing:
            raise SystemExit(
                "CSV is missing columns: " + ", ".join(sorted(missing))
            )

        with OUTPUT.open("w", encoding="utf-8") as output:
            for row_number, row in enumerate(reader, start=2):
                try:
                    card_id = int(row["card_id"])
                    level = int(row["topik_level"])
                except ValueError:
                    raise SystemExit(
                        f"{INPUT}, row {row_number}: card_id and "
                        "topik_level must be integers"
                    )

                if card_id in seen_ids:
                    raise SystemExit(
                        f"{INPUT}, row {row_number}: duplicate card_id {card_id}"
                    )
                seen_ids.add(card_id)

                if level < 1 or level > 6:
                    raise SystemExit(
                        f"{INPUT}, row {row_number}: topik_level "
                        "must be between 1 and 6"
                    )

                segments = [
                    ("headword", row["hangul"].strip()),
                    ("example", row["example_ko"].strip()),
                ]

                for target_segment, text in segments:
                    if not text:
                        continue

                    for voice_id in VOICES:
                        job = {
                            "card_id": card_id,
                            "topik_level": level,
                            "target_segment": target_segment,
                            "text": text,
                            "voice_id": voice_id,
                            "output_key": (
                                f"audio/topik{level}/{card_id}/"
                                f"{target_segment}/{voice_id}.mp3"
                            ),
                        }
                        output.write(
                            json.dumps(job, ensure_ascii=False) + "\n"
                        )
                        job_count += 1

    print(f"Created {job_count} audio jobs: {OUTPUT}")


if __name__ == "__main__":
    main()

