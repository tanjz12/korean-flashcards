import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAudioUrl } from "../lib/audioUrl";

const TTS_VOICE_KEY = "korean_vocab_tts_voice";

export const TTS_VOICE_OPTIONS = [
  { value: "ko-KR-SunHiNeural", label: "SunHi" },
  { value: "ko-KR-InJoonNeural", label: "InJoon" },
  { value: "ko-KR-HyunsuNeural", label: "Hyunsu" },
];

function extractVariants(card) {
  const variants = card?.audio?.variants;
  if (!variants) return [];

  if (Array.isArray(variants)) {
    return variants
      .map((item, idx) => ({
        key: item?.key || item?.id || String(idx),
        voice: item?.voice || "",
        rawUrl: item?.url || item?.path || (typeof item === "string" ? item : null),
      }))
      .filter((v) => v.rawUrl);
  }

  if (typeof variants === "object") {
    return Object.entries(variants)
      .map(([key, item]) => ({
        key,
        voice: item?.voice || "",
        rawUrl: typeof item === "string" ? item : item?.url || item?.path || null,
      }))
      .filter((v) => v.rawUrl);
  }

  return [];
}

export function useCardAudio(card) {
  const [selectedVoice, setSelectedVoice] = useState(() => {
    try {
      return window.localStorage.getItem(TTS_VOICE_KEY) || "ko-KR-SunHiNeural";
    } catch {
      return "ko-KR-SunHiNeural";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(TTS_VOICE_KEY, selectedVoice);
    } catch {
      // Ignore storage errors
    }
  }, [selectedVoice]);

  const audioRef = useRef(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const activeAudio = useMemo(() => {
    if (!card) return { url: null, voiceLabel: "Browser Speech" };

    const normalizedVariants = extractVariants(card);
    const shortVoiceKey = selectedVoice
      .replace(/^ko-KR-/i, "")
      .replace(/Neural$/i, "")
      .toLowerCase();

    const matchedVariant = normalizedVariants.find(
      (v) =>
        v.voice === selectedVoice ||
        (shortVoiceKey && v.key.toLowerCase() === shortVoiceKey)
    );

    const defaultKey = card?.audio?.default?.toLowerCase();
    const defaultVariant =
      (defaultKey && normalizedVariants.find((v) => v.key.toLowerCase() === defaultKey)) ||
      normalizedVariants[0];

    const chosen = matchedVariant || defaultVariant || null;
    const resolvedUrl =
      resolveAudioUrl(chosen?.rawUrl) || resolveAudioUrl(card.audio_url) || null;

    const activeVoiceId = chosen?.voice || selectedVoice;
    const matchedOption = TTS_VOICE_OPTIONS.find((opt) => opt.value === activeVoiceId);

    const voiceLabel = resolvedUrl
      ? matchedOption?.label ||
        chosen?.key ||
        activeVoiceId.replace(/^ko-KR-/, "").replace(/Neural$/, "")
      : "Browser Speech";

    return { url: resolvedUrl, voiceLabel };
  }, [card, selectedVoice]);

  const speakFallback = useCallback((text) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ko-KR";
      window.speechSynthesis.speak(utter);
    }
  }, []);

  const playAudio = useCallback(
    (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (!card) return;

      stopAudio();

      if (activeAudio.url) {
        const audio = new Audio(activeAudio.url);
        audioRef.current = audio;
        audio.play().catch(() => {
          if (audioRef.current === audio) audioRef.current = null;
          speakFallback(card.word);
        });
      } else {
        speakFallback(card.word);
      }
    },
    [card, activeAudio.url, speakFallback, stopAudio]
  );

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  return { selectedVoice, setSelectedVoice, activeAudio, playAudio, stopAudio };
}
