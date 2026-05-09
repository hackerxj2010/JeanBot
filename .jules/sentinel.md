## 2025-05-09 - Path Prefix Bypass in Terminal Service
**Vulnerability:** A path prefix bypass in the `TerminalService.resolveCwd` method allowed unauthorized directory access.
**Learning:** Using `startsWith` for path validation without trailing slash enforcement or proper relative path resolution is insecure. `/app/workspace-secret` starts with `/app/workspace`.
**Prevention:** Use `path.relative` to verify that a target path is contained within a root directory. A target is within a root if `path.relative(root, target)` does not start with `..` and is not absolute.
