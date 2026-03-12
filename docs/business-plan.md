# Limbo — Business Plan

**Date:** March 2026
**Author:** Pepper Potts, CMO
**Status:** Draft v1.0

---

## Executive Summary

Limbo is a privacy-first personal memory agent — a local-first second brain with a conversational interface. It captures ideas, remembers context across time, and surfaces knowledge through semantic search and Maps of Content (MOCs). It runs in Docker, talks via Telegram or MCP-compatible gateways, and uses Claude as its reasoning backbone. Data never leaves the user's machine.

The personal knowledge management market is worth $2.45B today and growing at 15.8% CAGR to $9.12B by 2033. The convergence of AI-native tools and privacy-conscious users has created a gap no current product fills: **local-first + AI memory + conversational interface**. Obsidian owns local-first but has no native AI. Mem.ai has AI but not privacy. Nobody has both, plus natural language access.

Limbo fills that gap.

**3-month make-or-break target:** $2,500 MRR (200 paid users at $10/month average)
**Primary channel:** Hacker News + Reddit (week 3 launch blitz, zero spend)
**Core wedge:** Obsidian power users + AI users frustrated by stateless LLMs
**Infrastructure partner:** Relied Cloud (Option 1 — "Deploy to Relied Cloud" button, LatAm distribution)

---

## Value Proposition & Positioning

### The Core Problem

Every time you open Claude, ChatGPT, or any LLM, you start from zero. Your personal context — your projects, decisions, ideas, history — lives in your head, in scattered notes, or in cloud apps you don't fully trust. You re-explain yourself constantly. AI tools are powerful but amnesiac.

The alternatives have fundamental flaws:
- **Cloud AI memory tools** (Mem.ai, Rewind) require you to trust a third party with everything you know
- **Local note apps** (Obsidian, Logseq) are powerful but not conversational and have no persistent AI memory
- **Generic AI assistants** (ChatGPT memory, Claude Projects) are locked to one platform and not local-first

### Limbo's Answer

> "Your second brain. Runs locally. Thinks with you."

Limbo is the first product that gives you persistent AI memory that:
1. **Stays on your machine** — Docker-based, no cloud sync required
2. **Talks like a human** — conversational access via Telegram or any MCP-compatible interface
3. **Remembers across time** — semantic search over a growing personal knowledge graph
4. **Connects ideas** — atomic notes, Maps of Content, automatic linking

### Positioning Statement

For privacy-conscious knowledge workers and developers who want AI that remembers their context, Limbo is the only personal memory agent that combines local-first privacy with a conversational AI interface — unlike cloud-based tools that require you to trust third parties with your most sensitive information.

---

## Revenue Model

### Strategic Direction: The Ghost Model for PKM

**Decision: Limbo will be fully open source.** This isn't a question anymore — it's the strategy.

The "SaaS is dead" thesis is playing out in real time. Traditional closed-source SaaS is being disrupted by open-source alternatives with hosted tiers. The SaaS self-hosting market is projected to hit $85.2B by 2034 (18.5% CAGR). EU Data Act enforcement and regulatory pressure on vendor lock-in are accelerating this. Power users will increasingly demand the ability to run their own infrastructure.

**The new baseline is BYOS + BYAI.** "Bring Your Own Server, Bring Your Own AI" — self-hosted Docker + user-provided LLM API keys (or local Ollama) — is free. No feature restrictions. The value proposition for paying customers is not feature gating; it's *convenience*.

Ghost is the canonical example: fully open source, free to self-host, $3M+ ARR, profitable since 2014. Monetizes exclusively through Ghost Pro managed hosting. Takes 0% of user revenue. Posthog, Plausible, Cal.com, Supabase — all follow the same playbook.

**For Limbo, open source is ideologically consistent with local-first privacy AND a distribution strategy.** Technical users (the primary segment) will clone, star, and spread it. The moat is not the code — it's the managed service quality, the community, and ongoing development velocity.

**Open-Source Monetization Models (ranked by fit for Limbo):**

| Model | How It Works | Limbo Fit | Example |
|-------|-------------|-----------|---------|
| **Managed hosting** | Self-host free; pay for zero-ops instance | ⭐⭐⭐⭐⭐ | Ghost Pro, Plausible Cloud |
| **Open-core** | Core open; premium features proprietary | ⭐⭐⭐ | GitLab, Posthog |
| **Server partnership** | Revenue share with infrastructure provider | ⭐⭐⭐⭐ | Unique opportunity — see below |
| **Dual licensing** | AGPL (free) + commercial license | ⭐⭐ | MongoDB, Elasticsearch |
| **Sponsorship/GitHub Sponsors** | Community donations | ⭐ | Supplement only |

**What stays open source:**
- Core vault engine (notes, MOCs, semantic search)
- MCP tools layer
- Docker compose configuration
- Telegram and OpenClaw gateways
- All data formats (plain Markdown)

**What we monetize:**
- Managed hosting (zero Docker setup, 1-click deploy, managed updates)
- Cross-device sync service
- Multi-user / team vaults
- Uptime guarantees + priority support
- (Future) Advanced AI pipeline integrations

This is the Ghost model applied to PKM: **the code is yours, the convenience is ours.**

**Financial impact:** Typical open-source conversion: 1-5% of self-hosted users convert to managed/paid. At 10,000 self-hosted users → 100-500 paying. Same end-state as closed-source projections, with significantly more community credibility, GitHub momentum, and organic distribution. The free-tier pool is 5x-10x larger than a closed product would produce.

**Downside:** Competitors can fork faster. Mitigation: community loyalty, managed service quality, and dev velocity are the real moat.

---

### Relied Cloud Partnership — Strategic Asset

**Opportunity:** Tomas has a direct relationship with the CEO of Relied Cloud, an Argentine server provider. This is not just a vendor relationship — it's a partnership-level distribution opportunity.

**Partnership model options (recommend pursuing in this order):**

1. **"Deploy to Relied Cloud" button** — 1-click Limbo deployment on Relied Cloud VPS. Limbo handles the app layer; Relied Cloud handles infrastructure. Revenue share or referral fee (15-20%). Users who don't want to manage Docker get a simple button.

2. **White-label managed tier** — Relied Cloud offers "Limbo Hosting" as a product on their platform. Splits recurring revenue. Handles Latin American market natively (Spanish-speaking, regional payments, local latency).

3. **Co-marketing** — Relied Cloud newsletter + social channels promote Limbo as a flagship use case for their VPS product. Cross-promotion to their existing customer base of developers and indie hackers.

**Why this matters:**
- Infrastructure partnership removes the biggest bottleneck to monetization (managed hosting is capital-intensive to build alone)
- Latin American market is underserved by existing PKM tools — Memorae.ai is the only Spanish-language player, and they're reminder-only
- Reduces dependency on AWS/GCP/DO pricing; Argentine-based costs may be more competitive
- Relationships > cold outreach — this is a shortcut to enterprise deals

**Near-term action:** Founder conversation to define the commercial structure before public launch. Goal: launch with a "Deploy to Relied Cloud" option available Day 1.

---

### Subscription Tiers

| Tier | Price | Description | Target User |
|------|-------|-------------|-------------|
| **Community** | Free | Full open-source core, self-hosted Docker, BYOS + BYAI | Technical users, evaluators, power users |
| **Cloud Solo** | $9/month | Managed instance (no Docker), 1-click deploy, managed updates, support | Non-technical knowledge workers |
| **Cloud Pro** | $19/month | Solo + multi-device sync, advanced MCP integrations, custom MOC templates, API access | Power users, indie hackers |
| **Cloud Team** | $15/user/month | Shared vault, team MOCs, admin controls, SSO (roadmap) | Small teams, research groups |

### Pricing Rationale

- **Free tier is the product, not a trial.** Full features, no artificial limits. Trust must be earned before payment. BYOS users are the community, evangelists, and GitHub stars engine.
- **$9/month Cloud Solo** is purely convenience pricing — they could self-host for free. This must be frictionless enough to justify it. Undercuts Roam ($15-20), matches Reflect.
- **$19/month Cloud Pro** captures the power-user segment paying $20+ for Notion/Roam. Sync is the primary unlock.
- **$15/user Team** opens B2B without enterprise complexity.

### Revenue Streams

1. **Managed hosting subscriptions (primary):** 80% of revenue
2. **Relied Cloud partnership (revenue share):** supplementary, especially strong in LatAm
3. **Enterprise licensing (12+ month horizon):** Air-gapped deployments for enterprises. Custom pricing.

### Unit Economics (3-month sprint targets)

| Metric | Month 1 | Month 2 | Month 3 |
|--------|---------|---------|---------|
| Free users (Community / self-hosted) | 200 | 600 | 1,500 |
| Paid users (Cloud Solo + Pro) | 0 | 50 | 200 |
| Average Revenue Per User | — | $10/month | $10/month |
| Monthly Recurring Revenue | $0 | $500 | $2,500 |
| Churn target | — | < 8% | < 6% |

**Do-or-die signal at month 3:** 200 paid users + > 40% weekly retention = continue. Below 50 paid users + flat retention = pivot or kill.

**Relied Cloud partnership contribution (Month 2-3):** Additional 20-30% of paid conversions via the "Deploy to Relied Cloud" button. LatAm market gives us Spanish-language distribution that no competitor currently owns.

---

## Target Personas & User Segments

### Persona 1: "The Obsidian Defector" (GTM Wedge)
**Profile:** Developer or researcher, 28-42, technical, privacy-conscious
**Current setup:** Obsidian with 20+ plugins, daily notes, maybe Dataview. Has tried Mem.ai, hated giving up their data.
**Pain point:** *"Obsidian is powerful but I can't just talk to it."* — This phrase hits hard for anyone in this persona. It's the entire thesis in one sentence.
**Trigger:** Reads about Limbo on HN or r/PKMS. Tries it in Docker. Converts within 2 weeks.
**LTV:** High. Churns slowly once invested in a PKM system.
**Acquisition:** HN Show HN post, Obsidian community forums, Reddit r/PKMS
**Note:** This is the go-to-market wedge, not the entire market. They give us GitHub stars, HN upvotes, and word-of-mouth. The real scale is Persona 2.

### Persona 2: "The Overwhelmed Founder" ⭐ *New — Board Input*
**Profile:** Startup founder or operating executive, 35-55, tech savvy but tool-agnostic
**Current setup:** Microsoft Todo + Notes + WhatsApp voice memos to themselves. Nothing connects. Everything lives in their head.
**Pain point:** "I have a million things in my head and no system that keeps up with me. I forget names, context, decisions. I re-explain myself to everyone."
**Trigger:** Hears the phrase *"just talk to it and it remembers"* + *"your data never leaves your machine"* + *"plain text files, no lock-in"* — the **aha moment happens before they even open the app.** The value prop lands in the description, not the demo.
**What resonates:** Privacy + simplicity of Markdown files = "I understand this. I trust this. I don't need to understand the AI part."
**What doesn't matter:** Docker, Obsidian, MCP, second brain theory — they don't care. Value first, mechanics later.
**LTV:** Very high. This persona is willing to pay without needing to be technical-converted. Word-of-mouth in peer networks (founders talk to founders).
**Acquisition:** Twitter/X, LinkedIn, founder communities, Relied Cloud LatAm channel, warm referrals
**Why this matters:** This is the persona that scales. Obsidian Defectors get us to 1,000 users. Overwhelmed Founders get us to 100,000.

### Persona 3: "The Context-Starved Solo Builder"
**Profile:** Indie hacker or freelancer, 25-38, building products or consulting
**Current setup:** Notion for projects, ChatGPT for brainstorming — but they don't talk to each other
**Pain point:** "I have 500 Notion pages and 1,000 ChatGPT conversations. Every new AI session, I start from zero."
**Trigger:** Sees Limbo demo. Frustrated by Microsoft Recall backlash. Wants local alternative.
**LTV:** Medium-high. Pays for productivity tools, needs clear ROI fast.
**Acquisition:** Twitter/X, indie hacker communities, Product Hunt

### Persona 4: "The Privacy Activist"
**Profile:** Security researcher, privacy advocate, journalist — 30-50
**Current setup:** Obsidian or plain files, no cloud anything
**Pain point:** "AI memory tools are surveillance tech by another name."
**Trigger:** Any major AI privacy incident (there will be more). Limbo's local-first message resonates immediately.
**LTV:** Very high if converted. Extremely vocal advocates.
**Acquisition:** Security Twitter, EFF community, FOSS communities

### Persona 5: "The Research Academic"
**Profile:** PhD student, postdoc, or researcher, 25-45
**Current setup:** Zotero + Obsidian + too many PDFs, struggling to synthesize across papers
**Pain point:** "I need to connect ideas across hundreds of papers and my own notes. No tool does this well."
**Trigger:** Lab mate uses it. Or finds it while looking for Obsidian AI plugins.
**LTV:** Medium (often limited budget), but huge referral multiplier within academia.
**Acquisition:** Academic Twitter, r/academia, word of mouth

---

## Growth Projections (3-Month Sprint)

Startups live and die in 3 months. This is the plan. No 12-month projections — they're fiction at this stage.

### Phase 1: Ignite (Month 1)
**Goal:** Public launch, first 200 active users, product-market fit signal

- Week 1-2: Docker one-liner + GitHub public + seed 15-20 alpha users
- Week 3: "Show HN" + Reddit blitz (r/selfhosted, r/ObsidianMD, r/PKMS) simultaneously
- Week 4: Telegram community open, fix top bugs from launch feedback
- Revenue: $0 (all free tier — build trust first)
- **Key signal:** > 50% of launch-week users still active in week 2

### Phase 2: Convert (Month 2)
**Goal:** 600 active users, first 50 paid

- Week 5: Product Hunt launch (ride HN momentum)
- Week 6: Relied Cloud "Deploy" button live + co-announcement (LatAm distribution)
- Week 7-8: Introduce Cloud Solo tier ($9/month) — managed hosting, zero Docker ops
- Double down on whichever channel drove the most retention (not just signups)
- **Key signal:** ≥ 3% free-to-paid conversion rate

### Phase 3: Hit the Gas or Pivot (Month 3)
**Goal:** 1,500 active users, 200 paid, $2,500 MRR

- If working: Obsidian plugin to marketplace, referral mechanic, Relied Cloud co-marketing
- If not working: diagnose, narrow the use case, and pivot fast within the window
- Pro tier ($19/month) introduced mid-month for power users
- **Key signal (week 12 verdict):** See make-or-break criteria below

### Revenue Projection (3-Month)

| Week | Users (total) | Paid Users | MRR |
|------|--------------|------------|-----|
| 2 | 50 | 0 | $0 |
| 4 | 200 | 0 | $0 |
| 6 | 400 | 20 | $200 |
| 8 | 600 | 50 | $500 |
| 10 | 1,000 | 120 | $1,400 |
| 12 | 1,500 | 200 | $2,500 |

### Make-or-Break Criteria (End of Month 3)

| Outcome | Signal | Decision |
|---------|--------|----------|
| **Go** | 200+ paid, > 40% weekly retention | Continue, bootstrap or raise |
| **Iterate** | 50-200 paid, retention growing | 3 more months, narrow focus |
| **Pivot** | < 50 paid, flat/declining retention | Change use case or approach |

---

## Key Risks & Mitigations

### Risk 1: OpenAI / Anthropic releases native local memory
**Likelihood:** Medium | **Impact:** High

If Claude or ChatGPT ship local memory that's genuinely private, the core differentiator weakens.

**Mitigation:**
- Obsidian/Markdown compatibility as a moat — users own their data in standard formats
- MCP architecture means Limbo becomes a *layer* that works with any LLM, not a competitor
- Community and open-source core create switching costs

### Risk 2: Docker friction kills adoption
**Likelihood:** High | **Impact:** Medium

Most potential users will not set up Docker. Technical barrier = smaller addressable market.

**Mitigation:**
- 1-click install scripts for Mac and Linux (Month 1 priority)
- Homebrew formula, apt/brew packages
- Managed hosting tier (Cloud Solo) removes ops entirely — planned Week 7-8 of sprint
- Target technical users first (Obsidian/dev crowd is comfortable with CLI)

### Risk 3: Churn from "new toy" effect
**Likelihood:** High | **Impact:** Medium

PKM tools have a high adoption → abandonment rate. Users try them, get excited, then stop using.

**Mitigation:**
- Daily habit loop design: morning inbox, Telegram notifications for "memory of the day"
- Friction-free capture (Telegram message → note in seconds)
- Show value over time: "Your memory grew by 47 notes this month" style engagement

### Risk 4: Privacy as liability (data breach even with local-first)
**Likelihood:** Low | **Impact:** Critical

If a security vulnerability exposed vault contents, the entire brand thesis collapses.

**Mitigation:**
- Security audit before any public launch
- Encryption at rest (AES-256) for vault
- No telemetry ever — privacy by design, not policy
- Transparent, open-source architecture that the community can audit

---

## Strategic Assumptions

1. The PKM market continues growing at current CAGR (15%+)
2. Privacy concerns around AI memory tools increase (tailwind)
3. BYOS + BYAI becomes the expected baseline for developer tools — not a differentiator, a requirement
4. MCP becomes a mainstream standard for AI agent integration
5. Tomas (or founding team) can execute the technical roadmap in parallel with GTM
6. Relied Cloud partnership can be structured before public launch
7. No major competitor launches a privacy-first, open-source AI memory product in the next 12 months

---

## Next Steps (3-Month Sprint Order)

1. **Week 1: Docker + GitHub + Landing Page** — everything public, one Docker command, email capture live
2. **Week 1-2: Alpha recruitment** — 15-20 users from Tomas's network, Obsidian community
3. **Week 2: Relied Cloud call** — founder-to-founder, structure Option 1 ("Deploy to Relied Cloud" button). Target: live by week 6.
4. **Week 3: Launch blitz** — "Show HN" + Reddit (r/selfhosted, r/ObsidianMD, r/PKMS) same day
5. **Week 5: Product Hunt** — ride HN momentum
6. **Week 6: Relied Cloud integration live** — "Deploy" button on landing page + co-announcement
7. **Month 2: Cloud Solo tier ($9/month)** — managed hosting, zero Docker ops required
8. **Month 2: Obsidian plugin** — AI search over existing vault, plugin marketplace distribution
9. **Memorae.ai monitoring** — reminder-only today, but watch for expansion. LatAm is open territory.

---

*Sources: Market Research & Competitive Analysis (LIM-25), PKM market reports, competitor pricing (March 2026)*
