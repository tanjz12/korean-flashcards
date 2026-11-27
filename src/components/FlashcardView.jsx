import React from "react";
import { styles } from "../styles/appStyles";

export function FlashcardView({ card, currentProgress, flipped, activeAudio, onPlayAudio }) {
  return (
    <article style={{ ...styles.card, backgroundColor: flipped ? "#f8fafc" : "#ffffff" }}>
      <div>
        <div style={styles.badgeRow}>
          {card.level && <span style={styles.badge}>{card.level}</span>}
          {card.pos && <span style={styles.badgeMuted}>{card.pos}</span>}
          {card.hanja && <span style={styles.badgeMuted}>{card.hanja}</span>}
          {currentProgress?.status && (
            <span style={styles.statusBadge}>
              {currentProgress.status} · {currentProgress.interval_days}d · EF{" "}
              {currentProgress.ease_factor}
            </span>
          )}
        </div>

        <div style={styles.word}>{card.word}</div>

        {(card.pronunciation_hangul || card.ipa) && (
          <div style={styles.pronRow}>
            {card.pronunciation_hangul && (
              <span style={styles.pronHangul}>[{card.pronunciation_hangul}]</span>
            )}
            {card.ipa && <span style={styles.pronIpa}>{card.ipa}</span>}
          </div>
        )}

        {flipped ? (
          <div style={styles.meaningSection}>
            {Array.isArray(card.meanings) && card.meanings.length > 0 ? (
              <ol style={styles.senseList}>
                {card.meanings.map((m, idx) => (
                  <li key={`${m.sense || idx}-${idx}`} style={styles.senseItem}>
                    {m.sense && <span style={styles.senseTag}>{m.sense}</span>}
                    <span>{m.meaning || "—"}</span>
                    {m.guide_phrase && (
                      <div style={styles.guidePhrase}>예: {m.guide_phrase}</div>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p style={styles.fallbackMeaning}>{card.meaning || "No meaning available"}</p>
            )}
          </div>
        ) : (
          <div style={styles.prompt}>Press Space or click Reveal Meaning below</div>
        )}
      </div>

      <div style={styles.audioBar}>
        <button type="button" onClick={onPlayAudio} style={styles.audioBtn}>
          Play Audio
        </button>
        <span style={styles.audioMeta}>
          Voice: <strong>{activeAudio.voiceLabel}</strong>
        </span>
      </div>
    </article>
  );
}
