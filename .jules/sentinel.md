## 2026-05-07 - Terminal Guardrail Regex Bypass
**Vulnerability:** The terminal command blocklist was bypassable because it used word boundaries (`\b`) for patterns ending in non-word characters like `/` (e.g., `rm -rf /`).
**Learning:** Regex word boundaries (`\b`) only match transitions between word characters (`[a-zA-Z0-9_]`) and non-word characters or string start/end. They do not match between a non-word character and a space or string end.
**Prevention:** Use explicit character classes or anchors (e.g., `(?:^|[\s;&|])` and `(?:[\s;&|]|$)`) to define boundaries for commands that may include non-word characters, and always normalize whitespace before matching.
