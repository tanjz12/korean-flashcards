import argparse
import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import boto3
from dotenv import load_dotenv
import edge_tts

load_dotenv()

DEFAULT_VOICES: List[Tuple[str, str]] = [
    ("ko-KR-SunHiNeural", "sunhi"),
    ("ko-KR-InJoonNeural", "injoon"),
    ("ko-KR-HyunsuNeural", "hyunsu"),
]


def safe_slug(word: str) -> str:
    """Create a filesystem-safe, collision-free stem for a Korean headword."""
    digest = hashlib.sha1(word.encode("utf-8")).hexdigest()[:10]
    cleaned = re.sub(r"[^\w\uac00-\ud7a3-]+", "_", word.strip()).strip("_")
    prefix = cleaned[:24] if cleaned else "word"
    return f"{prefix}_{digest}"


def to_speakable_text(word: str) -> str:
    """Clean punctuation/hyphens around headwords before sending text to Edge TTS."""
    s = word.strip()
    # Strip leading/trailing hyphens, bullets, slashes, and whitespace
    s = re.sub(r"^[\s\-∙/·~.,!?()\[\]{}]+|[\s\-∙/·~.,!?()\[\]{}]+$", "", s)
    return s.strip()


def load_words(cards_path: Path, limit: Optional[int] = None) -> List[str]:
    raw = json.loads(cards_path.read_text(encoding="utf-8"))
    words: List[str] = []
    seen = set()

    for item in raw:
        if isinstance(item, str):
            w = item.strip()
        elif isinstance(item, dict):
            w = (item.get("word") or "").strip()
        else:
            continue

        if not w or w in seen:
            continue
        seen.add(w)
        words.append(w)
        if limit is not None and limit > 0 and len(words) >= limit:
            break

    return words


def load_manifest(manifest_path: Path) -> Dict[str, Any]:
    if not manifest_path.exists():
        return {}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def create_r2_client():
    endpoint = os.getenv("R2_ENDPOINT_URL") or os.getenv("CLOUDFLARE_R2_ENDPOINT")
    access_key = os.getenv("R2_ACCESS_KEY_ID") or os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY") or os.getenv("AWS_SECRET_ACCESS_KEY")
    if not (endpoint and access_key and secret_key):
        return None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


async def generate_tts_batch(
    jobs: List[Tuple[str, str, Path]],
    concurrency: int = 4,
    max_retries: int = 3,
) -> Dict[Tuple[str, str], Path]:
    """Generate MP3 files with retries and per-item failure isolation."""
    semaphore = asyncio.Semaphore(max(1, concurrency))
    succeeded: Dict[Tuple[str, str], Path] = {}

    async def worker(word: str, voice: str, out_file: Path) -> None:
        if out_file.exists() and out_file.stat().st_size > 0:
            succeeded[(word, voice)] = out_file
            return

        speak_text = to_speakable_text(word)
        if not speak_text:
            print(f"[skip] No speakable text for '{word}' ({voice})")
            return

        async with semaphore:
            for attempt in range(1, max_retries + 1):
                try:
                    out_file.parent.mkdir(parents=True, exist_ok=True)
                    communicate = edge_tts.Communicate(speak_text, voice)
                    await communicate.save(str(out_file))

                    if out_file.exists() and out_file.stat().st_size > 0:
                        succeeded[(word, voice)] = out_file
                        return

                    raise RuntimeError("Generated audio file is empty")
                except Exception as exc:
                    if out_file.exists() and out_file.stat().st_size == 0:
                        out_file.unlink(missing_ok=True)
                    if attempt < max_retries:
                        await asyncio.sleep(0.6 * attempt)
                    else:
                        print(f"[warn] Skipping '{word}' ({voice}) after {max_retries} attempts: {exc}")

    await asyncio.gather(*(worker(w, v, p) for w, v, p in jobs))
    return succeeded


def upload_to_r2(
    s3_client,
    bucket: str,
    local_file: Path,
    r2_key: str,
    max_retries: int = 3,
) -> bool:
    for attempt in range(1, max_retries + 1):
        try:
            s3_client.upload_file(
                str(local_file),
                bucket,
                r2_key,
                ExtraArgs={"ContentType": "audio/mpeg"},
            )
            return True
        except Exception as exc:
            if attempt < max_retries:
                asyncio.run(asyncio.sleep(0.5 * attempt))
            else:
                print(f"[warn] R2 upload failed for '{r2_key}': {exc}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate 3-voice Korean TTS audio and update audio_manifest.json")
    parser.add_argument("--cards", type=Path, default=Path("data/flashcards.json"), help="Input flashcards or merged vocab JSON")
    parser.add_argument("--audio-dir", type=Path, default=Path("audio_out"), help="Output directory for generated audio")
    parser.add_argument("--manifest", type=Path, default=Path("data/audio_manifest.json"), help="Output manifest JSON path")
    parser.add_argument("--r2-base-url", type=str, default=os.getenv("R2_PUBLIC_BASE_URL", ""), help="Base URL for audio variants")
    parser.add_argument("--r2-bucket", type=str, default=os.getenv("R2_BUCKET_NAME", ""), help="R2 bucket name")
    parser.add_argument("--skip-r2", action="store_true", help="Skip uploading MP3 files to Cloudflare R2")
    parser.add_argument("--concurrency", type=int, default=4, help="Concurrent TTS synthesis requests")
    parser.add_argument("--retries", type=int, default=3, help="Retry attempts per TTS item")
    parser.add_argument("--limit", type=int, default=None, help="Optional max number of words to process")
    args = parser.parse_args()

    words = load_words(args.cards, limit=args.limit)
    tts_root = args.audio_dir / "tts"
    tts_root.mkdir(parents=True, exist_ok=True)

    jobs: List[Tuple[str, str, Path]] = []
    file_meta: Dict[Tuple[str, str], Tuple[str, Path]] = {}

    for word in words:
        stem = safe_slug(word)
        for voice_id, tag in DEFAULT_VOICES:
            filename = f"{stem}_{tag}.mp3"
            out_file = tts_root / filename
            r2_key = f"tts/{filename}"
            jobs.append((word, voice_id, out_file))
            file_meta[(word, voice_id)] = (r2_key, out_file)

    print(f"Generating up to {len(jobs)} TTS audio files ({len(DEFAULT_VOICES)} voices x {len(words)} words)...")
    succeeded = asyncio.run(
        generate_tts_batch(jobs, concurrency=args.concurrency, max_retries=args.retries)
    )

    s3_client = None
    bucket = args.r2_bucket.strip()
    if not args.skip_r2:
        s3_client = create_r2_client()
        if s3_client is None or not bucket:
            print("[info] R2 client or R2_BUCKET_NAME not configured; skipping R2 upload.")
            s3_client = None

    manifest = load_manifest(args.manifest)
    base_url = args.r2_base_url.rstrip("/")

    for word in words:
        existing_entry = manifest.get(word) if isinstance(manifest.get(word), dict) else {}
        existing_voices = {
            v.get("voice"): v
            for v in (existing_entry.get("voices") or [])
            if isinstance(v, dict) and v.get("voice")
        }

        for voice_id, _tag in DEFAULT_VOICES:
            out_file = succeeded.get((word, voice_id))
            if not out_file or not out_file.exists() or out_file.stat().st_size == 0:
                continue

            r2_key, _ = file_meta[(word, voice_id)]
            if s3_client is not None and bucket:
                upload_to_r2(s3_client, bucket, out_file, r2_key, max_retries=args.retries)

            variant_obj: Dict[str, Any] = {
                "voice": voice_id,
                "r2_key": r2_key,
            }
            if base_url:
                variant_obj["url"] = f"{base_url}/{r2_key}"
            existing_voices[voice_id] = variant_obj

        ordered_voices = [
            existing_voices[voice_id]
            for voice_id, _ in DEFAULT_VOICES
            if voice_id in existing_voices
        ]
        if ordered_voices:
            first_voice = ordered_voices[0]
            manifest[word] = {
                "provider_name": "Microsoft Neural TTS",
                "source_url": "https://github.com/rany2/edge-tts",
                "r2_key": first_voice["r2_key"],
                "url": first_voice.get("url"),
                "voices": ordered_voices,
            }

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    words_with_audio = sum(1 for w in words if w in manifest and manifest[w].get("voices"))
    print(
        f"Completed TTS pass: {len(succeeded)}/{len(jobs)} voice files ready; "
        f"{words_with_audio}/{len(words)} words have manifest entries in {args.manifest}."
    )


if __name__ == "__main__":
    main()
