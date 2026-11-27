import React from "react";
import { TTS_VOICE_OPTIONS } from "../hooks/useCardAudio";
import { styles } from "../styles/appStyles";

const LEVELS = ["ALL", "1급", "2급", "3급", "4급", "5급", "6급", "TOPIK 1", "TOPIK 2"];

export function FilterBar({
  search,
  onSearchChange,
  selectedVoice,
  onVoiceChange,
  levelFilter,
  onLevelChange,
  showQueueFilter,
  queueFilter,
  onQueueChange,
  totalCardsCount,
  dueCount,
}) {
  return (
    <div style={styles.controls}>
      <input
        type="search"
        placeholder="Search Hangul, pronunciation, IPA, Hanja, or meaning..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={styles.input}
      />

      <select
        aria-label="TTS Voice"
        value={selectedVoice}
        onChange={(e) => onVoiceChange(e.target.value)}
        style={styles.select}
      >
        {TTS_VOICE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            Voice: {opt.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Proficiency Level"
        value={levelFilter}
        onChange={(e) => onLevelChange(e.target.value)}
        style={styles.select}
      >
        {LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {lvl === "ALL" ? "All Levels" : lvl}
          </option>
        ))}
      </select>

      {showQueueFilter && (
        <select
          aria-label="Study Queue"
          value={queueFilter}
          onChange={(e) => onQueueChange(e.target.value)}
          style={styles.select}
        >
          <option value="ALL">All Cards ({totalCardsCount})</option>
          <option value="DUE">Due Now ({dueCount})</option>
          <option value="NEW">Unseen</option>
          <option value="MASTERED">Mastered</option>
        </select>
      )}
    </div>
  );
}
