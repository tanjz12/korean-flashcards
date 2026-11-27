import hashlib
import shutil
from pathlib import Path

SOURCE_DIR = Path("./audio_out/tts")
DEST_DIR = Path("./organized_audio/tts")
NUM_BUCKETS = 100
AUDIO_EXTS = {".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus"}
DRY_RUN = False # Set to False after verifying the dry-run output


def bucket_for_filename(filename: str, num_buckets: int = NUM_BUCKETS) -> str:
  digest_hex = hashlib.md5(filename.encode("utf-8")).hexdigest()
  bucket_num = int(digest_hex[:8], 16) % num_buckets
  return f"{bucket_num:02d}"


def sort_audio_into_folders() -> None:
  if not SOURCE_DIR.exists():
    print(f"Source folder not found: {SOURCE_DIR}")
    return

  DEST_DIR.mkdir(parents=True, exist_ok=True)
  processed = 0

  for file_path in SOURCE_DIR.iterdir():
    if not file_path.is_file() or file_path.suffix.lower() not in AUDIO_EXTS:
      continue

    bucket = bucket_for_filename(file_path.name, NUM_BUCKETS)
    target_dir = DEST_DIR / bucket
    target_dir.mkdir(exist_ok=True)
    target_path = target_dir / file_path.name

    if DRY_RUN:
      print(f"[DRY RUN] {file_path.name} -> {bucket}/{file_path.name}")
    else:
      shutil.move(str(file_path), str(target_path))

    processed += 1

  print(f"Processed {processed} files (DRY_RUN={DRY_RUN}).")


if __name__ == "__main__":
  sort_audio_into_folders()
