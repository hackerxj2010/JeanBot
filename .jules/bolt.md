## 2026-05-11 - Math.round vs toFixed for Negative Numbers
**Learning:** Math.round(-1.5) yields -1, whereas (-1.5).toFixed(0) yields -2. This difference in midpoint rounding for negative numbers can break deterministic outputs (like vector embeddings) when replacing toFixed with Math.round for performance.
**Action:** Use `v >= 0 ? Math.round(v * factor) / factor : -Math.round(-v * factor) / factor` to match toFixed behavior while maintaining the performance benefits of avoiding string conversions.
