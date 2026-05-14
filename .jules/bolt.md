## 2026-05-14 - Optimized AI Vector Generation Pipeline
**Learning:** High-dimensional vector operations (1536d) are heavily impacted by JS engine overhead from array methods (Array.from, map, reduce) and string-heavy operations like toFixed. Node 22's crypto.hash also provides a ~40% speed boost over createHash for small, frequent inputs.
**Action:** Use manual for loops with pre-allocated arrays for vectors. Implement fastRound utility for precision parity. Use one-shot crypto.hash where applicable. Ensure input normalization happens once at the entry point of the pipeline.
