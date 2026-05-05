## 2026-05-05 - Terminal Guardrail Bypass via Word Boundary
**Vulnerability:** The regex intended to block `rm -rf /` used a trailing `\b` (word boundary). Since `/` is a non-word character, `\b` did not match when `/` was followed by a space or the end of the string, allowing the command to bypass the guardrail.
**Learning:** Word boundaries (`\b`) in regex only work as expected when transitioning between a word character (`\w`) and a non-word character. They should not be used immediately after non-word characters like `/`.
**Prevention:** Avoid using `\b` after non-word characters in security regexes. Use explicit character classes or anchors if needed, or simply omit the boundary if the literal match is sufficient.
