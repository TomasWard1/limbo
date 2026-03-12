# Limbo Landing Page Brief (v1)

Owner: Pepper Potts (CMO)
Date: 2026-03-11
Issue: LIM-53

## Objective
Clarify Limbo’s value proposition and drive installs for the open‑source v1. The page must explain how Limbo works in seconds, reassure on privacy (local-first), and make the single-command install + Telegram connect feel effortless.

Primary success metric: Install CTA clicks → README views → Docker pulls. Secondary: GitHub stars and Telegram gateway connects.

## Target Audiences
- Developers: want local, hackable, privacy‑first tools they can run themselves.
- Knowledge workers: non‑technical users who value “a second brain” with no cloud lock‑in.

We will support both with a simple segment toggle on the page.

## Core Value Proposition
- Headline: “Your second brain, truly yours.”
- Subhead: “Limbo captures ideas, remembers everything, and connects knowledge over time — running locally on your machine. Your data never leaves.”
- Primary CTAs:
  - “Install with Docker” (primary)
  - “Star on GitHub” (secondary)

## Key Proofs
- Local‑first: all data stored locally; no cloud account required.
- Private by design: runs in Docker; no data leaves the machine.
- Works through chat: Telegram or HTTP via OpenClaw gateway.
- Fast recall: semantic search + Maps of Content (MOCs).

## Page Structure (IA)
1) Top Bar
- OSS badge, GitHub star counter/button, Docs link, GitHub link.

2) Hero (above the fold)
- Headline + subhead from “Core Value Proposition”.
- Primary CTA group: `Install` + `Star on GitHub`.
- Install snippet (copy‑to‑clipboard):
```bash
docker run --rm -p 18789:18789 \
  --env-file .env \
  -v limbo-data:/data \
  ghcr.io/limbo-ai/limbo:latest
```
- “Connect with Telegram” step (1 sentence) and link to docs section.
- Visual: short looped demo GIF of adding a note and recalling it.

3) Audience Toggle
- Segmented control: `Developers` | `Everyone`.
- Changes microcopy in the next two sections (“How it works” and “Features”).

4) How It Works (3 steps)
- Step 1 — Install Limbo locally (Docker one‑liner).
- Step 2 — Connect via Telegram or use HTTP endpoint.
- Step 3 — Capture ideas; Limbo links and recalls across time.

5) Features
- Atomic notes with semantic search.
- Maps of Content (MOCs) for navigation.
- Local‑first privacy: data never leaves your machine.
- MCP tools for vault operations; Claude as LLM backbone.

6) Open Source
- “Built in the open.”
- GitHub star counter + contributors avatars.
- Links: Repo, Issues, Roadmap, Discussions.

7) Privacy & Security
- Local Docker runtime; no external data exfiltration.
- Config surface: API keys stored locally; how to rotate/remove.
- Minimal telemetry: outline exactly what (if anything) is collected; default is off.

8) Demos
- Short clips or GIFs: capture, search, MOC navigation.

9) FAQ
- Is this cloud‑free? Yes, local.
- Which LLM? Claude via OpenClaw; keys stay local.
- Can I run offline? Core works; LLM needs connectivity.
- Will it work with Signal/WhatsApp? Roadmap note (Telegram now).

10) Footer
- Links: GitHub, Docs, License, Community, Twitter.

## Draft Copy (v1)
- Hero H1: Your second brain, truly yours.
- Hero Subhead: Capture ideas in the moment. Limbo remembers and connects them across time — locally on your machine, with private, semantic search.
- Primary CTA: Install with Docker
- Secondary CTA: Star on GitHub
- Dev toggle subhead: Built for developers who care about privacy, performance, and control.
- Everyone toggle subhead: A simple memory companion that works in your chat app.
- How it works (bullets):
  - Install locally with Docker in seconds.
  - Connect via Telegram or HTTP.
  - Capture, search, and link ideas with semantic context.
- Open Source: Limbo is open source and community‑driven. Star the repo and follow the roadmap.
- Privacy: Your data stays on your machine. Limbo processes notes locally; no third‑party servers receive your content.

## Developer Notes for Vision
- Components
  - `StarButton`: shows GitHub star count (client fetch or build‑time). Fallback copy if rate‑limited.
  - `InstallSnippet`: copy‑to‑clipboard + OS shell hint.
  - `SegmentedControl`: switches content for `Developers` vs `Everyone`.
  - `DemoPlayer`: small MP4/WEBM loop with reduced motion fallback.
- Instrumentation
  - Track: hero CTA clicks, copy‑install, star clicks, docs clicks.
  - Use simple `data-attr` hooks; no PII; local analytics or opt‑in.
- Performance/SEO
  - Static HTML with minimal JS for toggles and copy clipboard.
  - Preload demo poster images; defer videos.
  - Metadata: concise title, description, OpenGraph image.
- Accessibility
  - High‑contrast text, focus states, reduced‑motion preference.

## Acceptance Criteria
- Above‑the‑fold shows clear value proposition + install + GitHub star.
- Developer/Everyone toggle changes microcopy without reflow.
- Single‑command Docker snippet is copyable and correct.
- Telegram connect path is obvious (docs link or inline steps).
- Privacy section explicitly states “data never leaves your machine”.
- All CTAs work; GitHub star displays reliably with fallback.

## Next Steps
- Vision: implement this IA and copy in the web workspace.
- Pepper: provide demo GIFs and review copy after first pass.
- Optional: add a small “What’s new” changelog card near the footer.

---
References: Review open‑source landing patterns (e.g., OpenClaw, Paperclip) for star placement, install snippets, and concise how‑it‑works blocks. Keep Limbo’s color, logo, and theme.
