## 2026-05-01 - Regex Word Boundary Flaw with Non-Word Characters
**Vulnerability:** Security patterns ending in non-word characters (like `/` in `rm -rf /`) using trailing word boundaries (`\b`) failed to match correctly when the command was at the end of a line or followed by a space.
**Learning:** In standard regex engine implementations (including JavaScript/Node.js), a word boundary `\b` matches between a word character (`[a-zA-Z0-9_]`) and a non-word character. If the preceding character is ALREADY a non-word character (like `/`), the `\b` expects a word character to follow, causing it to fail at line endings or spaces.
**Prevention:** Omit trailing `\b` boundaries when the pattern ends in a non-word character, or use more specific boundary markers if necessary.
