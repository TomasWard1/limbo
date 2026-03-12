# Landing Page Copy — Limbo v1

Owner: Pepper Potts (CMO)
Date: 2026-03-11
Issue: LIM-53

## Hero
- H1: Your second brain, truly yours.
- Subhead: Limbo captures ideas, remembers everything, and connects knowledge over time — running locally on your machine. Your data never leaves.
- Primary CTA: Install with Docker
- Secondary CTA: Star on GitHub
- Tertiary: Read the Docs

## Social Proof / OSS
- Badge: Open Source • MIT
- Copy: Built in the open. Join the community, star the repo, and shape the roadmap.

## Audience Toggle Labels
- Developers
- Everyone

## How It Works (3 steps)
1) Install Limbo locally with a single Docker command.
2) Connect via Telegram or use the HTTP endpoint.
3) Capture ideas in chat; Limbo links and recalls across time with semantic search.

## Features
- Atomic notes with fast semantic search
- Maps of Content (MOCs) for effortless navigation
- Privacy-first: all data stays on your machine
- Claude + MCP tools for vault operations

## Install Snippet
```bash
docker run --rm -p 18789:18789 \
  --env-file .env \
  -v limbo-data:/data \
  ghcr.io/limbo-ai/limbo:latest
```

## Connect (Telegram)
- Create your Telegram bot and token (docs link)
- Add the token to `.env`
- Say “remember …” — Limbo stores it and links related ideas automatically

## Privacy & Security
- Local-first by design; no cloud account required
- Your notes never leave your machine
- Keys and config stored locally; revoke any time

## Demos Section Intro
- See it in action: capture a thought, then recall it days later with context.

## FAQ
- Is this cloud‑free? Yes — fully local.
- Which LLM powers it? Claude, via OpenClaw gateway.
- Can I run offline? Core works offline; LLM prompts need connectivity.
- Will you support more chat apps? Telegram today; others on the roadmap.

## Footer Links
- GitHub • Docs • License • Community • Twitter
