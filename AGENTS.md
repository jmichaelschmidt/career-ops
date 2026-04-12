# Career-Ops for Codex

Read `CLAUDE.md` for all project instructions, routing, and behavioral rules. They apply equally to Codex.

Codex uses an advisory-only profile in this repo:
- Run Career-Ops as a standalone local workspace, not through OpenClaw.
- Keep all browser and file actions local and human-reviewed.
- Allow `scan`, `auto-pipeline`, `oferta`, `deep`, `pdf`, `tracker`, `pipeline`, and `check-liveness`.
- Refuse `apply`, `batch`, and `node update-system.mjs apply` unless the user explicitly changes the safety boundary.

Key points:
- Reuse the existing modes, scripts, templates, and tracker flow — do not create parallel logic.
- Store user-specific customization in `config/profile.yml`, `modes/_profile.md`, or `article-digest.md` — never in `modes/_shared.md`.
- Never submit an application on the user's behalf.

For Codex-specific setup, see `docs/CODEX.md`.
