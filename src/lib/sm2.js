/**
 * Pure SM-2 spaced repetition calculation.
 * quality: 1 = Again, 3 = Hard, 4 = Good, 5 = Easy
 */
export function calculateSm2(prev = {}, quality = 4) {
  let repetitions = Number.isFinite(prev.repetitions) ? prev.repetitions : 0;
  let interval = Number.isFinite(prev.interval_days) ? prev.interval_days : 0;
  let easeFactor = Number.isFinite(prev.ease_factor) ? prev.ease_factor : 2.5;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }

    if (quality === 3) {
      interval = Math.max(1, Math.round(interval * 0.8));
    } else if (quality === 5) {
      interval = Math.max(interval + 1, Math.round(interval * 1.3));
    }

    repetitions += 1;
  }

  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  easeFactor = Math.max(1.3, Number((easeFactor + delta).toFixed(2)));

  let status = "learning";
  if (quality < 3) {
    status = "learning";
  } else if (repetitions >= 3 && interval >= 7) {
    status = "mastered";
  } else {
    status = "review";
  }

  const now = new Date();
  const nextReview = new Date(now.getTime() + interval * 86400000);

  return {
    status,
    repetitions,
    ease_factor: easeFactor,
    interval_days: interval,
    last_reviewed_at: now.toISOString(),
    next_review_at: nextReview.toISOString(),
  };
}
