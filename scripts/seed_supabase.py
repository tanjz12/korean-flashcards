import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()


def chunked(items: List[Any], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def normalize_row(card: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "word": card["word"].strip(),
        "meanings": card.get("meanings") or [],
        "pos": (card.get("pos") or "").strip(),
        "level": (card.get("level") or "").strip(),
        "hanja": (card.get("hanja") or "").strip(),
        "ipa": (card.get("ipa") or "").strip(),
        "pronunciation_hangul": (card.get("pronunciation_hangul") or "").strip(),
        "audio": card.get("audio") or {"default": None, "type": None, "variants": {}},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Upsert flashcards JSON into Supabase")
    parser.add_argument("--in", dest="input_path", type=Path, default=Path("data/flashcards.json"))
    parser.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args()

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(url, key)

    payload = json.loads(args.input_path.read_text(encoding="utf-8"))
    raw_cards = payload.get("cards", []) if isinstance(payload, dict) else payload
    rows = [normalize_row(c) for c in raw_cards if c.get("word")]

    total = 0
    for batch in chunked(rows, args.batch_size):
        supabase.table("flashcards").upsert(batch, on_conflict="word").execute()
        total += len(batch)
        print(f"Upserted {total}/{len(rows)} cards...")

    print(f"Finished seeding {total} flashcards into Supabase.")


if __name__ == "__main__":
    main()
