#!/usr/bin/env python3

import csv
import json
import os
import sys
import time
from pathlib import Path

import krdict

SEED_TSV = Path("data/source/results.tsv")
OUTPUT = Path("data/generated/source_import.jsonl")

SEED_URL = (
    "https://github.com/julienshim/"
    "combined_korean_vocabulary_list/blob/master/results.tsv"
)
NIKL_URL = "https://krdict.korean.go.kr/eng"

# Gentle pause between API requests. Check the API terms and limits.
REQUEST_PAUSE_SECONDS = 0.4


def load_env_file(path=Path(".env")):
    """Read KEY=value lines without requiring an extra dotenv package."""
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def clean(value):
    return (value or "").strip()


def read_seed_words():
    if not SEED_TSV.exists():
        raise SystemExit(f"Missing seed list: {SEED_TSV}")

    words = []
    seen = set()

    with SEED_TSV.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if "word" not in (reader.fieldnames or []):
            raise SystemExit("results.tsv must contain a 'word' column")

        for row in reader:
            word = clean(row.get("word"))
            if word and word not in seen:
                words.append(word)
                seen.add(word)

    return words


def get_results(api_response):
    """Extract result entries from the client's dictionary response."""
    payload = api_response.asdict()

    data = payload.get("data", {})
    if isinstance(data, dict):
        results = data.get("results", [])
        if isinstance(results, list):
            return payload, results

    return payload, []


def main():
    load_env_file()
    api_key = os.environ.get("KRDICT_KEY")
    if not api_key:
        raise SystemExit("Set KRDICT_KEY in .env or your shell environment.")

    krdict.set_key(api_key)

    seed_words = read_seed_words()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    imported = 0
    nikl_matches = 0

    with OUTPUT.open("w", encoding="utf-8") as output:
        for index, word in enumerate(seed_words, start=1):
            record = {
                "word": word,
                "seed_reference": {
                    "name": "Combined Korean Vocabulary List",
                    "url": SEED_URL,
                    "use": "word-selection only",
                },
                "nikl": {
                    "status": "not_found",
                    "source": "National Institute of the Korean Language",
                    "source_url": NIKL_URL,
                    "entries": [],
                },
            }

            try:
                response = krdict.search(query=word, raise_api_errors=True)
                raw_payload, results = get_results(response)

                # Retain exact headword matches only; don't silently choose
                # a similarly spelled or longer search result.
                exact = [
                    item for item in results
                    if clean(item.get("word")) == word
                ]

                if exact:
                    record["nikl"]["status"] = "matched"
                    record["nikl"]["entries"] = exact
                    record["nikl"]["response_source"] = NIKL_URL
                    nikl_matches += 1
                else:
                    record["nikl"]["status"] = "no_exact_match"
                    record["nikl"]["search_response"] = raw_payload

            except Exception as exc:
                record["nikl"]["status"] = "error"
                record["nikl"]["error"] = str(exc)

            official_topik_rows = topik_by_word.get(word, [])
            if official_topik_rows:
                record["topik"] = {
                    "status": "matched",
                    "source": "Test of Proficiency in Korean (TOPIK)",
                    "entries": official_topik_rows,
                }
                topik_matches += 1

            output.write(json.dumps(record, ensure_ascii=False) + "\n")
            imported += 1

            print(
                f"[{index}/{len(seed_words)}] {word}: "
                f"NIKL={record['nikl']['status']}, "
                f"TOPIK={record['topik']['status']}"
            )
            time.sleep(REQUEST_PAUSE_SECONDS)

    print(f"\nWrote {imported} word records to {OUTPUT}")
    print(f"Exact NIKL matches: {nikl_matches}")
    print(f"TOPIK source matches: {topik_matches}")


if __name__ == "__main__":
    main()

