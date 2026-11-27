import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { calculateSm2 } from "../lib/sm2";

const GUEST_PROGRESS_KEY = "korean_vocab_guest_progress_v1";

function readGuestProgress() {
  try {
    const raw = window.localStorage.getItem(GUEST_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeGuestProgress(map) {
  try {
    if (!map || Object.keys(map).length === 0) {
      window.localStorage.removeItem(GUEST_PROGRESS_KEY);
    } else {
      window.localStorage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(map));
    }
  } catch {
    // Ignore storage quota or privacy mode errors
  }
}

export function useProgressSync(userId, onError) {
  const [progressMap, setProgressMap] = useState({});
  const pendingQueueRef = useRef(new Map());
  const flushTimerRef = useRef(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const flushProgressQueue = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const activeUserId = userIdRef.current;
    if (!activeUserId || pendingQueueRef.current.size === 0) return;

    const batch = Array.from(pendingQueueRef.current.values());
    pendingQueueRef.current.clear();

    const { error: upsertErr } = await supabase
      .from("user_progress")
      .upsert(batch, { onConflict: "user_id,card_id" });

    if (upsertErr) {
      batch.forEach((item) => pendingQueueRef.current.set(item.card_id, item));
      onError?.(`Failed syncing progress: ${upsertErr.message}`);
    }
  }, [onError]);

  const queueProgressSave = useCallback(
    (payload) => {
      pendingQueueRef.current.set(payload.card_id, payload);
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushProgressQueue();
        }, 2500);
      }
    },
    [flushProgressQueue]
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushProgressQueue();
      }
    };
    window.addEventListener("pagehide", flushProgressQueue);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushProgressQueue);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushProgressQueue();
    };
  }, [flushProgressQueue]);

  useEffect(() => {
    if (!userId) {
      pendingQueueRef.current.clear();
      setProgressMap(readGuestProgress());
      return;
    }

    let active = true;
    const guestMap = readGuestProgress();

    supabase
      .from("user_progress")
      .select("card_id, status, repetitions, ease_factor, interval_days, last_reviewed_at, next_review_at")
      .eq("user_id", userId)
      .then(async ({ data, error: progErr }) => {
        if (!active) return;
        if (progErr) {
          onError?.(progErr.message);
          return;
        }

        const merged = {};
        (data || []).forEach((row) => {
          merged[row.card_id] = row;
        });

        const guestEntries = Object.values(guestMap);
        if (guestEntries.length > 0) {
          const toSync = [];
          for (const g of guestEntries) {
            if (!g?.card_id) continue;
            const existing = merged[g.card_id];
            const gTime = g.last_reviewed_at ? new Date(g.last_reviewed_at).getTime() : 0;
            const eTime = existing?.last_reviewed_at ? new Date(existing.last_reviewed_at).getTime() : 0;
            if (!existing || gTime > eTime) {
              const rowPayload = {
                user_id: userId,
                card_id: g.card_id,
                status: g.status,
                repetitions: g.repetitions,
                ease_factor: g.ease_factor,
                interval_days: g.interval_days,
                last_reviewed_at: g.last_reviewed_at || new Date().toISOString(),
                next_review_at: g.next_review_at,
              };
              merged[g.card_id] = rowPayload;
              toSync.push(rowPayload);
            }
          }

          let syncOk = true;
          if (toSync.length > 0) {
            const { error: syncErr } = await supabase
              .from("user_progress")
              .upsert(toSync, { onConflict: "user_id,card_id" });
            if (syncErr) {
              syncOk = false;
              onError?.(`Failed syncing guest progress: ${syncErr.message}`);
            }
          }

          if (syncOk) {
            writeGuestProgress({});
          }
        }

        if (active) {
          setProgressMap(merged);
        }
      });

    return () => {
      active = false;
    };
  }, [userId, onError]);

  const recordReview = useCallback(
    (cardId, currentProgress, quality) => {
      const nextSm2 = calculateSm2(currentProgress, quality);

      if (!userId) {
        const guestPayload = { card_id: cardId, ...nextSm2 };
        setProgressMap((prev) => {
          const updated = { ...prev, [cardId]: guestPayload };
          writeGuestProgress(updated);
          return updated;
        });
        return;
      }

      const payload = { user_id: userId, card_id: cardId, ...nextSm2 };
      setProgressMap((prev) => ({ ...prev, [cardId]: payload }));
      queueProgressSave(payload);
    },
    [userId, queueProgressSave]
  );

  return { progressMap, recordReview, flushProgressQueue };
}
