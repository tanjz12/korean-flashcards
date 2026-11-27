const AUDIO_BASE_URL = (import.meta.env.VITE_AUDIO_BASE_URL || "").replace(/\/+$/, "");
const NUM_BUCKETS = 100;

function md5Hex(str) {
  const utf8 = new TextEncoder().encode(str);
  const bitLen = utf8.length * 8;

  // Pad with 0x80, zero bytes, and a 64-bit little-endian bit length on a 64-byte boundary.
  const paddedLen = Math.ceil((utf8.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(utf8);
  padded[utf8.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  const rotL = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const add = (a, b) => (a + b) >>> 0;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a, B = b, C = c, D = d;

    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) % 16;
      }

      F = F >>> 0;
      const temp = D;
      D = C;
      C = B;
      const sum = add(add(A, F), add(K[j], M[g]));
      B = add(B, rotL(sum, S[j]));
      A = temp;
    }

    a = add(a, A);
    b = add(b, B);
    c = add(c, C);
    d = add(d, D);
  }

  return [a, b, c, d]
    .map((word) => {
      let out = "";
      for (let byte = 0; byte < 4; byte++) {
        out += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
      }
      return out;
    })
    .join("");
}

function withBucketSubfolder(cleanPath) {
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length === 0) return cleanPath;

  const rawFileName = segments.pop();
  const normalizedFileName = rawFileName.normalize("NFC");
  const lastParent = segments[segments.length - 1];

  if (lastParent && /^\d{2}$/.test(lastParent)) {
    return [...segments, normalizedFileName].join("/");
  }

  const bucketNum = parseInt(md5Hex(normalizedFileName).slice(0, 8), 16) % NUM_BUCKETS;
  const bucket = String(bucketNum).padStart(2, "0");
  return [...segments, bucket, normalizedFileName].join("/");
}

export function resolveAudioUrl(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const bucketedPath = withBucketSubfolder(trimmed.replace(/^\/+/, ""));
  const encodedPath = bucketedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return AUDIO_BASE_URL ? `${AUDIO_BASE_URL}/${encodedPath}` : `/${encodedPath}`;
}

export function getCardAudioUrl(card, selectedVoice) {
  const audio = card?.audio;
  if (!audio) return null;

  if (typeof audio === "string") {
    return resolveAudioUrl(audio);
  }

  if (audio.variants && typeof audio.variants === "object") {
    const voiceKey =
      (selectedVoice && audio.variants[selectedVoice] && selectedVoice) ||
      (audio.default && audio.variants[audio.default] && audio.default) ||
      Object.keys(audio.variants)[0];

    const variant = voiceKey ? audio.variants[voiceKey] : null;
    const rawPath = typeof variant === "string" ? variant : variant?.path || variant?.url;
    return resolveAudioUrl(rawPath);
  }

  return resolveAudioUrl(audio.path || audio.url);
}
