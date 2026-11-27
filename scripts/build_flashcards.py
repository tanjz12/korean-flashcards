import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

POS_MAP = {
    "명사": "noun",
    "동사": "verb",
    "형용사": "adjective",
    "부사": "adverb",
    "관형사": "determiner",
    "대명사": "pronoun",
    "수사": "numeral",
    "조사": "particle",
    "접사": "affix",
    "감탄사": "interjection",
    "의존 명사": "noun",
    "보조 동사": "verb",
    "보조 형용사": "adjective",
    "수사·관형사": "numeral",
    "대명사·관형사": "pronoun",
}

VOICE_SHORT_NAMES = {
    "ko-KR-SunHiNeural": "sunhi",
    "ko-KR-InJoonNeural": "injoon",
    "ko-KR-HyunsuNeural": "hyunsu",
}

HANGUL_RE = re.compile(r"[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]")
HANJA_PAREN_RE = re.compile(r"\([^)]*\)")


def base_word_from_key(raw_key: str) -> str:
    piece = re.split(r"[∙/\r\n]+", raw_key.strip())[0].strip()
    m = re.match(r"^(.+?)(\d{2})$", piece)
    if m and HANGUL_RE.search(m.group(1)):
        return m.group(1).strip()
    return piece


def clean_etymology(text: str) -> str:
    if not text:
        return ""
    cleaned = re.split(r"\n\s*Historical readings\b", text, maxsplit=1)[0]
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_derived_words(items: Any) -> List[str]:
    words: List[str] = []
    for d in items or []:
        if not isinstance(d, dict):
            continue
        raw = (d.get("word") or "").strip()
        if not raw:
            continue
        words.append(raw)
        stripped = HANJA_PAREN_RE.sub("", raw).strip()
        if stripped and stripped != raw:
            words.append(stripped)
    return words


def load_kaikki_index(kaikki_path: Optional[Path]) -> Dict[str, List[Dict[str, Any]]]:
    index: Dict[str, List[Dict[str, Any]]] = {}
    if not kaikki_path or not kaikki_path.exists():
        return index

    with kaikki_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("lang_code") and row.get("lang_code") != "ko":
                continue
            word = (row.get("word") or "").strip()
            if word:
                index.setdefault(word, []).append(row)
    return index


def find_kaikki_entries(
    kaikki_index: Dict[str, List[Dict[str, Any]]],
    word: str,
) -> List[Dict[str, Any]]:
    entries = list(kaikki_index.get(word) or [])
    if not entries:
        stripped = word.lstrip("-").rstrip("-").strip()
        if stripped and stripped != word:
            entries = list(kaikki_index.get(stripped) or [])
    return entries


def extract_kaikki_candidates(entries: List[Dict[str, Any]], ko_pos: str = "") -> List[Dict[str, Any]]:
    expected_pos = POS_MAP.get(ko_pos.strip(), "") if ko_pos else ""
    preferred: List[Dict[str, Any]] = []
    fallback: List[Dict[str, Any]] = []

    for entry in entries:
        entry_pos = (entry.get("pos") or "").lower()
        if entry_pos == "character" and expected_pos != "character":
            continue

        pos_matches = bool(expected_pos) and (
            entry_pos == expected_pos
            or (expected_pos == "affix" and entry_pos in {"affix", "suffix", "prefix"})
        )
        target = preferred if pos_matches else fallback

        etymology = clean_etymology(entry.get("etymology_text") or "")
        entry_derived = extract_derived_words(entry.get("derived")) + extract_derived_words(entry.get("compounds"))

        for sense in entry.get("senses") or []:
            glosses = [g.strip() for g in (sense.get("glosses") or []) if g and g.strip()]
            if not glosses:
                continue

            tags = [t for t in (sense.get("tags") or []) if t]
            sense_derived = extract_derived_words(sense.get("derived")) + extract_derived_words(sense.get("compounds"))
            all_derived = list(dict.fromkeys(sense_derived + entry_derived))

            examples: List[Dict[str, str]] = []
            for ex in (sense.get("examples") or [])[:3]:
                if isinstance(ex, dict):
                    ko_text = (ex.get("text") or ex.get("ref") or "").strip()
                    en_text = (ex.get("english") or ex.get("translation") or "").strip()
                    if ko_text or en_text:
                        examples.append({"ko": ko_text, "en": en_text})

            target.append({
                "word": entry.get("word", ""),
                "pos": entry.get("pos", ""),
                "etymology": etymology,
                "glosses": glosses,
                "tags": tags,
                "derived": all_derived,
                "examples": examples,
            })

    return preferred + fallback


def candidate_to_wiktionary(cand: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "word": cand["word"],
        "pos": cand["pos"],
        "glosses": cand["glosses"],
        "tags": cand["tags"],
        "etymology": cand["etymology"],
        "examples": cand["examples"],
    }


def extract_kaikki_sounds(entries: List[Dict[str, Any]]) -> Tuple[str, str]:
    ipa = ""
    hangul = ""
    for entry in entries:
        for s in entry.get("sounds") or []:
            if not isinstance(s, dict):
                continue
            if not ipa and s.get("ipa"):
                ipa = s["ipa"].strip()
            if not hangul and s.get("hangeul"):
                hangul = s["hangeul"].strip()
            if ipa and hangul:
                return ipa, hangul
    return ipa, hangul


def lookup_entry_for_sense(
    meaning_obj: Dict[str, Any],
    headword_candidates: List[Dict[str, Any]],
    kaikki_index: Dict[str, List[Dict[str, Any]]],
    fallback_cursor: Dict[str, int],
) -> Optional[Dict[str, Any]]:
    # Target the word/phrase for this specific sense first (e.g. "전문가", "주택가", "최고가")
    target_term = (meaning_obj.get("guide_phrase") or meaning_obj.get("meaning") or "").strip()

    if target_term:
        term_entries = find_kaikki_entries(kaikki_index, target_term)
        term_candidates = extract_kaikki_candidates(term_entries)
        if term_candidates:
            return candidate_to_wiktionary(term_candidates[0])

    # Fallback to the flashcard headword's own Wiktionary senses if the sense term isn't found
    if headword_candidates:
        idx = fallback_cursor.get("i", 0)
        best_cand = headword_candidates[idx] if idx < len(headword_candidates) else headword_candidates[0]
        if idx < len(headword_candidates):
            fallback_cursor["i"] = idx + 1
        return candidate_to_wiktionary(best_cand)

    return None


def normalize_phrase(word: str, text: str) -> str:
    clean = text.strip()
    if clean.startswith(word):
        clean = clean[len(word):].strip()
    return clean


def process_meanings(
    raw_meanings: List[Dict[str, Any]],
    word: str,
    card_pos: str,
    headword_entries: List[Dict[str, Any]],
    kaikki_index: Dict[str, List[Dict[str, Any]]],
    dedupe: bool = True,
) -> List[Dict[str, Any]]:
    headword_candidates = extract_kaikki_candidates(headword_entries, card_pos)
    fallback_cursor = {"i": 0}
    results: List[Dict[str, Any]] = []
    seen_keys: Dict[str, int] = {}

    for m in raw_meanings:
        sense = str(m.get("sense") or "").strip()
        meaning_txt = (m.get("meaning") or "").strip()
        guide_txt = (m.get("guide_phrase") or "").strip()
        hanja = (m.get("hanja") or "").strip()
        pos = (m.get("pos") or card_pos).strip()
        source = (m.get("source_id") or m.get("source") or "").strip()

        dedupe_sig = normalize_phrase(word, guide_txt or meaning_txt)
        if dedupe and dedupe_sig and dedupe_sig in seen_keys:
            existing = results[seen_keys[dedupe_sig]]
            if not existing["meaning"] and meaning_txt:
                existing["meaning"] = meaning_txt
            if not existing["guide_phrase"] and guide_txt:
                existing["guide_phrase"] = guide_txt
            if not existing["sense"] and sense:
                existing["sense"] = sense
            if not existing["hanja"] and hanja:
                existing["hanja"] = hanja
            if source and source not in existing["sources"]:
                existing["sources"].append(source)
            continue

        wikt = lookup_entry_for_sense(m, headword_candidates, kaikki_index, fallback_cursor)
        entry = {
            "sense": sense,
            "meaning": meaning_txt,
            "guide_phrase": guide_txt,
            "hanja": hanja,
            "pos": pos,
            "sources": [source] if source else [],
            "wiktionary": wikt,
        }
        if dedupe_sig:
            seen_keys[dedupe_sig] = len(results)
        results.append(entry)

    if not results and headword_candidates:
        for cand in headword_candidates:
            results.append({
                "sense": "",
                "meaning": "",
                "guide_phrase": "",
                "hanja": "",
                "pos": card_pos,
                "sources": ["kaikki_wiktionary"],
                "wiktionary": candidate_to_wiktionary(cand),
            })

    return results


def parse_audio_block(audio_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_voices = audio_info.get("voices") or []
    variants: Dict[str, Dict[str, str]] = {}
    default_key: Optional[str] = None
    primary_key = (audio_info.get("r2_key") or audio_info.get("path") or "").lstrip("/")

    for v in raw_voices:
        voice_name = (v.get("voice") or "").strip()
        rel_path = (v.get("r2_key") or v.get("path") or "").lstrip("/")
        if not rel_path:
            continue

        short_key = VOICE_SHORT_NAMES.get(voice_name)
        if not short_key:
            stem = Path(rel_path).stem
            short_key = stem.split("_")[-1].lower() if "_" in stem else voice_name.lower()

        variants[short_key] = {
            "voice": voice_name,
            "path": rel_path,
        }
        if primary_key and rel_path == primary_key:
            default_key = short_key
        elif default_key is None:
            default_key = short_key

    if not variants and primary_key:
        variants["default"] = {"voice": "", "path": primary_key}
        default_key = "default"

    if not variants:
        return None

    return {
        "default": default_key,
        "type": (audio_info.get("type") or audio_info.get("audio_type") or "tts").strip(),
        "variants": variants,
    }


def build_flashcards(
    merged_vocab_path: Path,
    audio_manifest_path: Optional[Path],
    kaikki_path: Optional[Path],
    dedupe_meanings: bool = True,
) -> tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    merged_entries = json.loads(merged_vocab_path.read_text(encoding="utf-8"))
    kaikki_index = load_kaikki_index(kaikki_path)

    cards_by_word: Dict[str, Dict[str, Any]] = {}
    source_registry: Dict[str, Dict[str, Any]] = {}

    for item in merged_entries:
        word = (item.get("word") or "").strip()
        if not word:
            continue

        for src in item.get("sources") or []:
            src_id = src.get("id")
            if src_id and src_id not in source_registry:
                source_registry[src_id] = src

        headword_entries = find_kaikki_entries(kaikki_index, word)
        fallback_ipa, fallback_hangul = extract_kaikki_sounds(headword_entries)

        pos = (item.get("pos") or "").strip()
        cards_by_word[word] = {
            "word": word,
            "pos": pos,
            "level": (item.get("level") or "").strip(),
            "hanja": (item.get("hanja") or "").strip(),
            "ipa": (item.get("ipa") or fallback_ipa).strip(),
            "pronunciation_hangul": (item.get("pronunciation_hangul") or fallback_hangul).strip(),
            "audio": {
                "default": None,
                "type": None,
                "variants": {},
            },
            "meanings": process_meanings(
                item.get("meanings") or [],
                word=word,
                card_pos=pos,
                headword_entries=headword_entries,
                kaikki_index=kaikki_index,
                dedupe=dedupe_meanings,
            ),
        }

    if audio_manifest_path and audio_manifest_path.exists():
        manifest = json.loads(audio_manifest_path.read_text(encoding="utf-8"))

        for raw_key, audio_info in manifest.items():
            word = base_word_from_key(raw_key)
            if word not in cards_by_word or not isinstance(audio_info, dict):
                continue

            audio_obj = parse_audio_block(audio_info)
            if audio_obj:
                cards_by_word[word]["audio"] = audio_obj
                source_registry.setdefault("tts_generated", {
                    "id": "tts_generated",
                    "name": audio_info.get("provider_name", "Microsoft Neural TTS"),
                    "url": audio_info.get("source_url", "https://github.com/rany2/edge-tts"),
                    "license_note": "Synthesized Korean pronunciation audio",
                })

    return list(cards_by_word.values()), source_registry


def main() -> None:
    parser = argparse.ArgumentParser(description="Build simplified flashcards.json with relative audio & Wiktionary senses")
    parser.add_argument("--merged-vocab", type=Path, default=Path("data/merged_vocab.json"))
    parser.add_argument("--audio-manifest", type=Path, default=Path("data/audio_manifest.json"))
    parser.add_argument("--kaikki", type=Path, default=Path("data/source/kaikki_Korean.jsonl"))
    parser.add_argument("--no-dedupe-meanings", action="store_true", help="Keep duplicate NIKL/Julienshim meaning entries separate")
    parser.add_argument("--wrap-meta", action="store_true", help="Output { sources, cards } object instead of a flat array")
    parser.add_argument("--words", nargs="+", default=None, help="Build only for specific words, e.g. --words -가 가게 가격")
    parser.add_argument("--limit", type=int, default=None, help="Limit output to the first N flashcards")
    parser.add_argument("--stdout", action="store_true", help="Print JSON to stdout instead of writing to --out")
    parser.add_argument("--out", type=Path, default=Path("data/flashcards.json"))
    args = parser.parse_args()

    cards, sources = build_flashcards(
        merged_vocab_path=args.merged_vocab,
        audio_manifest_path=args.audio_manifest,
        kaikki_path=args.kaikki,
        dedupe_meanings=not args.no_dedupe_meanings,
    )

    if args.words:
        wanted = {w.strip() for w in args.words if w.strip()}
        cards = [c for c in cards if c.get("word") in wanted]

    if args.limit is not None:
        cards = cards[: max(0, args.limit)]

    matched = sum(1 for c in cards if any(m.get("wiktionary") is not None for m in c.get("meanings") or []))
    payload: Any = {"sources": list(sources.values()), "cards": cards} if args.wrap_meta else cards
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)

    if args.stdout:
        print(rendered)
        return

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    print(f"Wrote {len(cards)} flashcards to {args.out} ({matched} with Wiktionary data)")


if __name__ == "__main__":
    main()
