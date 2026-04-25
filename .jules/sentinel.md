# JeanBot Sentinel Security Log

## 2026-04-25 - Robust Secret Redaction
**Discovery:** Simple regex like `sk-[A-Za-z0-9_-]+` can cause false positives if the token is part of a longer word.
**Fix:** Use negative lookbehind `(?<![\w-])` and lookahead `(?![\w-])` to enforce word boundaries for API keys.
**Impact:** Reduced false positives in redaction and more accurate labeling for Anthropic, OpenAI, Stripe, and GitHub keys.

## 2026-04-25 - Terminal Command Hardening
**Discovery:** Attackers can pipe remote scripts to bash even if basic commands like `rm` are blocked.
**Fix:** Block pipe and redirection patterns to common interpreters (`| bash`, `> sh`, etc.) in `TerminalService`.
**Impact:** Improved protection against remote code execution via tool use.
