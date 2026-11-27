import React from "react";
import { styles } from "../styles/appStyles";

export function SourceAttribution({ sources }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;

  return (
    <footer style={styles.attributionBox}>
      <div style={styles.attributionTitle}>Sources & Attribution</div>
      <ul style={styles.attributionList}>
        {sources.map((src) => (
          <li key={src.id} style={styles.attributionItem}>
            {src.url ? (
              <a href={src.url} target="_blank" rel="noreferrer" style={styles.link}>
                {src.name}
              </a>
            ) : (
              <span>{src.name}</span>
            )}
            {src.license_note ? ` — ${src.license_note}` : ""}
          </li>
        ))}
      </ul>
    </footer>
  );
}
