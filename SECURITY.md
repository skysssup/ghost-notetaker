# Security Policy

## Supported versions

| Version          | Supported   |
| ---------------- | ----------- |
| `0.1.x` / `main` | Yes         |
| Older tags       | Best effort |

Ghost Notetaker is a local Electron desktop app. Please keep Electron and npm dependencies reasonably current when packaging releases.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Please report vulnerabilities privately by emailing **skysssup@users.noreply.github.com**, or by opening a private [GitHub Security Advisory](https://github.com/skysssup/ghost-notetaker/security/advisories/new) on this repository once it is available.

Include as much of the following as you can:

- Description of the issue and impact
- Steps to reproduce (PoC if available)
- Affected platform (macOS / Windows) and app version or commit
- Suggested fix, if you have one

We aim to acknowledge reports within **7 days** and to share a remediation plan or status update within **30 days**. Please give us a reasonable window to ship a fix before any public disclosure.

## Scope notes

In scope:

- Local privilege or sandbox escapes via the app
- IPC / preload bridge exposure that can be abused by untrusted content
- Path traversal or unsafe file handling in export/import
- Dependency vulnerabilities that are exploitable in normal use

Out of scope / expected behavior:

- Notes being readable on disk by other processes with the same user privileges (local JSON storage by design)
- Screen-capture exclusion failing on unsupported OS builds (documented platform limitation)
- Social-engineering or physical-access attacks against the user’s machine
