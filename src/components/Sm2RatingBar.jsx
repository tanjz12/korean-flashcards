import React from "react";
import { styles } from "../styles/appStyles";

export function Sm2RatingBar({ onRate }) {
  return (
    <div style={styles.sm2Row}>
      <button type="button" onClick={() => onRate(1)} style={styles.againBtn}>
        Again (1d)
      </button>
      <button type="button" onClick={() => onRate(3)} style={styles.hardBtn}>
        Hard
      </button>
      <button type="button" onClick={() => onRate(4)} style={styles.goodBtn}>
        Good
      </button>
      <button type="button" onClick={() => onRate(5)} style={styles.easyBtn}>
        Easy
      </button>
    </div>
  );
}
