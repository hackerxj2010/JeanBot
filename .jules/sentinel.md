## 2026-04-26 - Broken Regex and Secret Leak in TerminalService
**Vulnerability:** The regex pattern for blocking `rm -rf /` used a trailing word boundary `\b`, which failed to match the command because `/` is a non-word character. Additionally, the terminal output preview was leaking sensitive API keys.
**Learning:** Word boundaries (`\b`) in regex behave differently depending on whether the character is a "word" character or not. Using `\b` after `/` prevents matching unless followed by a word character.
**Prevention:** Avoid using `\b` at the end of patterns that end in non-word characters. Always apply redaction utilities to output previews of high-privilege tools.
