import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { getCardAudioUrl, resolveAudioUrl } from "./lib/audioUrl";
import { useProgressSync } from "./hooks/useProgressSync";
import { useCardAudio } from "./hooks/useCardAudio";
import { AuthPanel } from "./components/AuthPanel";
import { FilterBar } from "./components/FilterBar";
import { FlashcardView } from "./components/FlashcardView";
import { Sm2RatingBar } from "./components/Sm2RatingBar";
import { SourceAttribution } from "./components/SourceAttribution";
import { styles } from "./styles/appStyles";

const PAGE_SIZE = 1000;
const BATCH_SIZE = 20;

function getMeaningSearchText(card) {
  return (card?.meanings || [])
    .flatMap((m) => [m?.meaning, m?.guide_phrase, m?.hanja])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function fetchAllFlashcards(levelFilter) {
  let from = 0;
  const rows = [];

  while (true) {
    let query = supabase
      .from("flashcards")
      .select("id, word, hanja, ipa, pronunciation_hangul, pos, level, audio, meanings, sources")
      .order("word", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (levelFilter !== "ALL") {
      query = query.eq("level", levelFilter);
    }

    const { data, error } = await query;
    if (error) {
      return { data: null, error };
    }

    const chunk = data || [];
    rows.push(...chunk);

    if (chunk.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [cards, setCards] = useState([]);
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [queueFilter, setQueueFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [batchOffset, setBatchOffset] = useState(0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const userId = session?.user?.id || null;
  const { progressMap, recordReview, flushProgressQueue } = useProgressSync(userId, setError);

  const resetSessionPosition = useCallback(() => {
    setBatchOffset(0);
    setIndex(0);
    setFlipped(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        flushProgressQueue();
      }
      setSession(nextSession);
    });
    return () => subscription.unsubscribe();
  }, [flushProgressQueue]);

  useEffect(() => {
    let active = true;

    async function loadCards() {
      setLoading(true);
      setError("");

      const { data, error: err } = await fetchAllFlashcards(levelFilter);
      if (!active) return;

      if (err) {
        setError(err.message);
        setCards([]);
      } else {
        setCards(data || []);
        setBatchOffset(0);
        setIndex(0);
        setFlipped(false);
      }
      setLoading(false);
    }

    loadCards();
    return () => {
      active = false;
    };
  }, [levelFilter]);

  useEffect(() => {
    resetSessionPosition();
  }, [userId, resetSessionPosition]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowMs = Date.now();

    return cards.filter((c) => {
      const prog = progressMap[c.id];
      const isDue = !prog || !prog.next_review_at || new Date(prog.next_review_at).getTime() <= nowMs;

      if (queueFilter === "DUE" && !isDue) return false;
      if (queueFilter === "NEW" && prog) return false;
      if (queueFilter === "MASTERED" && prog?.status !== "mastered") return false;

      if (!q) return true;
      const meaningsText = getMeaningSearchText(c);
      return (
        c.word.toLowerCase().includes(q) ||
        meaningsText.includes(q) ||
        (c.hanja && c.hanja.toLowerCase().includes(q)) ||
        (c.ipa && c.ipa.toLowerCase().includes(q)) ||
        (c.pronunciation_hangul && c.pronunciation_hangul.toLowerCase().includes(q))
      );
    });
  }, [cards, search, queueFilter, progressMap]);

  const safeBatchOffset =
    filteredCards.length > 0 ? batchOffset % filteredCards.length : 0;

  const sessionCards = useMemo(() => {
    if (!filteredCards.length) return [];
    const end = Math.min(safeBatchOffset + BATCH_SIZE, filteredCards.length);
    return filteredCards.slice(safeBatchOffset, end);
  }, [filteredCards, safeBatchOffset]);

  const safeIndex = sessionCards.length > 0 ? index % sessionCards.length : 0;
  const card = sessionCards[safeIndex];
  const currentProgress = card ? progressMap[card.id] : null;

  const totalBatches = Math.max(1, Math.ceil(filteredCards.length / BATCH_SIZE));
  const currentBatchNumber = Math.floor(safeBatchOffset / BATCH_SIZE) + 1;

  const [selectedVoiceDraft, setSelectedVoiceDraft] = useState(null);
  const selectedVoice = selectedVoiceDraft ?? card?.audio?.default ?? "sunhi";

  const resolvedAudioUrl = useMemo(
    () => getCardAudioUrl(card, selectedVoice),
    [card, selectedVoice]
  );

  const playableCard = useMemo(() => {
    if (!card) return null;

    const audio = card.audio;
    if (!audio || typeof audio !== "object" || !audio.variants) {
      return {
        ...card,
        audioUrl: resolvedAudioUrl,
      };
    }

    const resolvedVariants = Object.fromEntries(
      Object.entries(audio.variants).map(([key, variant]) => [
        key,
        {
          ...variant,
          path: resolveAudioUrl(variant?.path),
          url: resolveAudioUrl(variant?.url || variant?.path),
        },
      ])
    );

    return {
      ...card,
      audioUrl: resolvedAudioUrl,
      audio: {
        ...audio,
        variants: resolvedVariants,
      },
    };
  }, [card, resolvedAudioUrl]);

  const { activeAudio, playAudio, stopAudio } = useCardAudio(playableCard);

  const nextCard = useCallback(() => {
    if (!sessionCards.length) return;
    stopAudio();
    setFlipped(false);
    setIndex((prev) => (prev + 1) % sessionCards.length);
  }, [sessionCards.length, stopAudio]);

  const prevCard = useCallback(() => {
    if (!sessionCards.length) return;
    stopAudio();
    setFlipped(false);
    setIndex((prev) => (prev - 1 + sessionCards.length) % sessionCards.length);
  }, [sessionCards.length, stopAudio]);

  const nextBatch = useCallback(() => {
    if (!filteredCards.length) return;
    stopAudio();
    setFlipped(false);
    setIndex(0);
    setBatchOffset((prev) => {
      const current = prev % filteredCards.length;
      const next = current + BATCH_SIZE;
      return next >= filteredCards.length ? 0 : next;
    });
  }, [filteredCards.length, stopAudio]);

  const handleSm2Review = useCallback(
    (quality) => {
      if (!card) return;
      recordReview(card.id, currentProgress, quality);
      nextCard();
    },
    [card, currentProgress, recordReview, nextCard]
  );

  useEffect(() => {
    function onKeyDown(e) {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!loading && card) {
          setFlipped((f) => !f);
        }
      } else if (e.code === "ArrowRight") {
        nextCard();
      } else if (e.code === "ArrowLeft") {
        prevCard();
      } else if (e.key?.toLowerCase() === "a") {
        if (!loading && card) {
          playAudio();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextCard, prevCard, playAudio, loading, card]);

  const dueCount = useMemo(() => {
    const nowMs = Date.now();
    return cards.filter((c) => {
      const prog = progressMap[c.id];
      return !prog || !prog.next_review_at || new Date(prog.next_review_at).getTime() <= nowMs;
    }).length;
  }, [cards, progressMap]);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Korean Vocabulary</h1>
          <p style={styles.subtitle}>Space to flip · ←/→ to navigate · A for audio</p>
        </div>
        {sessionCards.length > 0 && (
          <span style={styles.counter}>
            {safeIndex + 1} / {sessionCards.length} · Batch {currentBatchNumber}/{totalBatches} (
            {filteredCards.length} cards)
          </span>
        )}
      </header>

      <AuthPanel
        session={session}
        progressCount={Object.keys(progressMap).length}
        dueCount={dueCount}
        onBeforeSignOut={flushProgressQueue}
        onError={setError}
      />

      <FilterBar
        search={search}
        onSearchChange={(val) => {
          setSearch(val);
          resetSessionPosition();
        }}
        selectedVoice={selectedVoice}
        onVoiceChange={setSelectedVoiceDraft}
        levelFilter={levelFilter}
        onLevelChange={(val) => {
          setLevelFilter(val);
          resetSessionPosition();
        }}
        showQueueFilter={Boolean(session?.user)}
        queueFilter={queueFilter}
        onQueueChange={(val) => {
          setQueueFilter(val);
          resetSessionPosition();
        }}
        totalCardsCount={cards.length}
        dueCount={dueCount}
      />

      {loading && <div style={styles.statusBox}>Loading flashcards...</div>}
      {error && <div style={{ ...styles.statusBox, color: "#b91c1c" }}>Error: {error}</div>}
      {!loading && !error && !card && (
        <div style={styles.statusBox}>No flashcards match your current filters.</div>
      )}

      {!loading && !error && card && (
        <>
          <FlashcardView
            card={card}
            currentProgress={currentProgress}
            flipped={flipped}
            activeAudio={activeAudio}
            onPlayAudio={playAudio}
          />

          <Sm2RatingBar onRate={handleSm2Review} />

          <div style={styles.navRow}>
            <button type="button" onClick={prevCard} style={styles.navButton}>
              ← Prev
            </button>
            <button type="button" onClick={() => setFlipped((f) => !f)} style={styles.navButton}>
              {flipped ? "Show Front" : "Flip Card"}
            </button>
            <button type="button" onClick={nextCard} style={styles.navButton}>
              Next →
            </button>
            <button type="button" onClick={nextBatch} style={styles.navButton}>
              Next {BATCH_SIZE}
            </button>
          </div>

          <SourceAttribution sources={card.sources} />
        </>
      )}
    </main>
  );
}
