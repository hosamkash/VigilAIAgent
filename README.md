# Vigil AI Agent v1.1

Personal desktop AI coding agent built on **Tauri 2** + **React** + **Cline SDK** (`@cline/sdk` → `@cline/core`).

## Phase 0 — SDK API (verified)

`@cline/sdk` re-exports `@cline/core`. There is **no** `Cline` class.

| Expected (plan) | Actual (`@cline/sdk` 0.2.0) |
| --- | --- |
| `import { Cline }` | `import { ClineCore } from "@cline/sdk"` |
| `list_files` tool | Not in SDK. Default tools: `read_files`, `search_codebase`, `run_commands`, `fetch_web_content`, `apply_patch`, `editor`, `skills`, `ask_question`, `submit_and_exit` |
| Session API | `await ClineCore.create({ clientName })` then `cline.start({ config, prompt })` |

Vigil wraps this in `src/lib/cline-engine.ts` and provides `list_files` in `src/lib/tools.ts`.

## Stack

- Agent: Cline SDK (`ClineCore`) via Node 22+ sidecar
- Desktop: Tauri 2 (Rust)
- UI: React + TypeScript + Vite + Tailwind + Zustand
- Editor: Monaco **Diff** Editor
- Secrets: OS Keychain (`keyring` crate) + per-launch HMAC secret
- Search: Ripgrep only (MVP)
- License: Apache 2.0 (see `LICENSE`)

## Commands

```bash
npm install
npm test                 # Phase 0 / unit tests
npm run dev              # Vite UI only
source ~/.cargo/env && npm run tauri dev   # full desktop
```

## Layout

- Left 35% — Chat (`What can I do for you?`)
- Right 65% — Monaco Diff + Terminal
- Settings — BYOK OpenAI / Gemini / Anthropic → Rust `save_api_key` → OS Keychain
