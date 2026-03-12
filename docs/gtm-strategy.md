# Limbo — Go-to-Market Strategy

**Date:** March 2026
**Author:** Pepper Potts, CMO
**Status:** Draft v2.0 — 3-Month Sprint Edition

---

## Executive Summary

3 months. Make it or break it. No gradual ramp, no 12-month runway fantasies.

The plan: ship fast, seed hard in week 1-2, launch publicly in week 3-4, and hit the gas through month 2-3. **Traction in the first weeks is the signal.** If we don't have 50 active users talking about Limbo after the first public drop, we learn, adjust, and go again — within the same 3-month window.

**North star metric:** 200 paid users at month 3
**Do-or-die metric:** 50% weekly active retention by week 6
**Primary channel:** Hacker News + Reddit (organic, zero spend)
**Core message:** "Your second brain. Runs locally. Thinks with you."
**Week 1 target:** Working Docker one-liner + GitHub repo live

---

## Channel Strategy

### Tier 1: Owned Channels (zero cost, highest ROI)

**1. GitHub — The Distribution Engine**
- Open-source repo is day-1 launch vehicle
- README = best pitch deck we'll write. One Docker command. One GIF showing a real interaction.
- Target: 500 stars by end of week 2 (HN bounce), 2,000 by end of month 2
- Star count = social proof loop → more stars → more shares → more stars

**2. Telegram Bot (dogfooding as marketing)**
- Limbo's interface IS Telegram — every demo is a live product demo
- "Watch me use Limbo in real time" content is free and authentic
- Tomas should live-demo their own vault publicly. Transparency builds trust.

**3. Landing Page (limbo.app or equivalent)**
- One page, one CTA: "Self-host free" → GitHub, "We host it" → $9/month
- Email capture for everyone who isn't ready yet (nurture list)
- Up by end of week 1

### Tier 2: Earned Media — The Launch Blitz (Weeks 2-4)

These run in tight sequence, not spread across months:

**4. Hacker News — "Show HN"**
- Single highest-ROI action in the 3-month window
- Timing: Week 2 or 3, Wednesday 8-9am PT
- Title: `Show HN: Limbo – open-source local-first second brain with AI via Telegram`
- Must ship beforehand: Docker one-liner that works, 3-min demo video, clean README
- Target: front page (50+ points) → 500+ GitHub stars in 24h
- If it flops: wait 10 days, reframe hook, try again. Never run out of shots.

**5. Reddit — Simultaneous Blitz (same week as HN)**
- r/selfhosted (450K) — lead with Docker + privacy angle
- r/ObsidianMD (62K) — lead with "AI layer for your existing vault" angle
- r/PKMS (82K) — lead with second brain + conversational interface angle
- r/LocalLLaMA — for local Ollama integration angle
- Approach: post as a builder sharing your project, not a marketer
- Don't copy-paste across subreddits — each post must be native to that community

**6. Twitter/X — Real-Time Amplification**
- Tomas posts "I just shipped X" thread on same day as HN
- Tag relevant accounts (@kepano, privacy advocates, PKM thought leaders)
- Goal: one high-engagement thread that gets picked up organically
- Reply to every comment within 2 hours on launch day

**7. Relied Cloud — "Deploy to Relied Cloud" Button (Month 2)**
- 1-click Limbo deployment on Relied Cloud VPS
- Limbo handles the app layer; Relied Cloud handles infra
- Revenue share: 15-20% of conversions through their channel
- Founder-to-founder call → structure deal → live by week 6
- Immediate Latin American distribution: Spanish-language market, regional payments, local latency
- Memorae.ai dominates LatAm reminders — Limbo takes the PKM/power-user segment they don't serve
- Cross-promotion: Relied Cloud newsletter → their existing dev/indie hacker base

### Tier 3: Partnership Channels (Month 2-3)

**8. Obsidian Plugin** *(highest-leverage technical distribution, Month 2)*
- Plugin reads existing Obsidian vault → Limbo indexes it
- Hook: "AI search over your existing Obsidian notes in 1 command"
- Plugin marketplace: 1M+ users, organic discovery, zero spend
- Even 0.1% conversion = 1,000 potential customers

**9. Product Hunt**
- Launch in week 5-6, after HN buzz creates social proof
- HN stars + GitHub momentum = Product Hunt visibility
- Target: #1 of the day or top-5

---

## Messaging & Positioning Framework

### The One-Line Pitch
> "Your second brain. Runs locally. Thinks with you."

### Core Message Pillars

**Pillar 1: Open + Private (the why)**
> "Fully open source. Runs on your server. Thinks with you."

Use when: developer communities, HN, GitHub, open-source advocates
Proof points: 100% open source, Docker, BYOS + BYAI, MIT/AGPL license, no telemetry ever

**Pillar 2: Memory (the what)**
> "Stop re-explaining yourself. Limbo remembers."

Use when: AI power users, ChatGPT/Claude users frustrated by statelessness
Proof points: semantic search across personal vault, persistent context across sessions

**Pillar 3: Convenience without lock-in (the monetization angle)**
> "Self-host free forever. Or let us run it for you."

Use when: introducing paid tiers, addressing "why would I pay if it's free?"
Proof points: Ghost model — code is yours, managed hosting is the service

### Messaging by Audience

| Audience | Lead with | Hook |
|----------|-----------|------|
| Obsidian users | *"Obsidian is powerful but I can't just talk to it"* | Docker, no cloud, open-source |
| Overwhelmed founders | *"Just talk to it and it remembers. Your data never leaves your machine."* | Simplicity + privacy aha, no tech jargon |
| Developers / solo builders | Self-hostable, MCP-compatible | API docs, GitHub |
| Privacy advocates | Zero telemetry, data never leaves machine | Open-source code audit |
| LatAm market (via Relied Cloud) | Spanish-first, one-click deploy | Relied Cloud button, no Docker required |

### What We Don't Say
- ❌ "AI-powered notes" (too generic)
- ❌ "Second brain" alone (oversaturated)
- ❌ "Built with Claude" prominently (sounds dependent)
- ❌ Anything that sounds like Notion or Mem.ai

---

## 3-Month Launch Playbook

### Month 1 — Build & Ignite (Weeks 1-4)

**Week 1-2: Ship the Minimum Viable Launch**
- [ ] Docker compose one-liner working on Mac + Linux + WSL
- [ ] GitHub repo public, README explains in 30 seconds
- [ ] Landing page live (email capture + two CTAs)
- [ ] Seed 15-20 alpha users from personal network
- [ ] Tomas starts "build in public" Twitter thread

**Week 3: The Launch**
- [ ] "Show HN" Wednesday 8am PT
- [ ] Reddit blitz: r/selfhosted + r/ObsidianMD + r/PKMS same day
- [ ] Twitter/X thread by Tomas (link to HN for social proof loop)
- [ ] Monitor HN thread — Tomas responds to every comment same day

**Week 4: Capitalize + Fix**
- [ ] Fix top 3 issues surfaced by alpha users
- [ ] First Telegram community channel open (50+ members from HN wave)
- [ ] Product Hunt prep: screenshots, tagline, hunter relationships
- [ ] Founder call with Relied Cloud CEO — structure partnership deal

**Week 4 Check: Make-or-break signal**
> If GitHub stars < 300 and email signups < 200 after launch week, the messaging or product has a problem. Diagnose before month 2.

---

### Month 2 — Traction or Pivot (Weeks 5-8)

**Hypothesis to test:** Are people actually using Limbo daily after installing it?

**Week 5: Product Hunt**
- Launch with HN momentum as social proof
- Target: #2-3 of the day minimum
- Email list gets first heads-up 24h before

**Week 6: Relied Cloud Integration Live**
- "Deploy to Relied Cloud" button on landing page
- Co-announcement with Relied Cloud social/newsletter
- LatAm-targeted messaging in Spanish (Tomas's native market)

**Week 7-8: Doubles Down on What Worked**
- If HN drove most users → write more technical content, run second HN post with an update angle
- If Obsidian community drove users → ship the Obsidian plugin earlier
- If LatAm response is strong → build Spanish-language docs
- Introduce Solo tier ($9/month) for managed hosting

**Week 8 Check: Paid conversion signal**
> Target: 50 paid users ($9 Solo tier). If conversion rate is < 3%, the free-to-paid value gap is too wide. Fix the pitch or the onboarding.

---

### Month 3 — Hit the Gas or Learn Fast (Weeks 9-12)

**If traction is working:**
- Ship Obsidian plugin to marketplace
- Double Relied Cloud partnership investment (co-marketing budget)
- Launch referral mechanic: "invite 3 friends → 1 month free"
- Start SEO content: "Obsidian vs Limbo", "self-hosted AI memory"
- Push toward 200 paid users and $2,500 MRR

**If traction is weak (< 30% weekly retention at week 9):**
- Don't double down — diagnose. Talk to churned users directly.
- Pivot hypothesis: is the Docker friction killing us? → prioritize Relied Cloud managed path
- Pivot hypothesis: is the use case wrong? → go narrower (just personal CRM, just meeting notes)
- Pivot hypothesis: messaging? → run 3 different landing page variants

**Week 12 Check: The Verdict**
> - 200 paid users + > 40% weekly retention → **keep going, raise or bootstrap**
> - 50-200 paid users + growing → **tweak and extend, 3 more months**
> - < 50 paid users + flat retention → **strategic pivot or kill**

---

## Early Adopter Acquisition Tactics

### Tactic 1: The HN Effect (Week 3)
One good HN post delivers 500-2,000 GitHub stars in 24 hours. This is the highest-ROI single action.
- Requirement: polished demo + rock-solid Docker setup
- If post flops: wait 10 days, reframe angle, try again — same 3-month window

### Tactic 2: The Obsidian Plugin Trojan Horse (Month 2)
Plugin reads existing vault files → Limbo indexes them. Users get "AI search over existing Obsidian notes."
- Converts gradually as users move their primary workflow into Limbo
- Plugin marketplace = passive discovery, zero ongoing effort

### Tactic 3: The Privacy Incident Playbook (Always-On)
Every major AI privacy incident is a distribution event.
- Maintain a "stay-ready" Twitter draft: "If [incident] spooked you, here's the local-first alternative..."
- Google Alerts on "AI memory privacy" + "second brain data" — respond within 2 hours

### Tactic 4: Build In Public (Month 1 → ongoing)
Tomas documenting the build on Twitter/X generates pre-launch interest and authenticity.
- Weekly posts: what shipped, what broke, what users said
- First-person narrative is the unfakeable moat against well-funded competitors

### Tactic 5: Power User Seeding (Week 2)
Identify 10 high-follower PKM/developer Twitter accounts. DM directly with access.
- One tweet from @kepano or equivalent = thousands of targeted impressions
- White-glove Docker setup call if needed — worth it for the amplification

---

## Community Building Plan

### The Limbo Telegram Community (Week 4+)
- Keep it simple: one channel, Tomas active daily
- Share vault insights, answer questions, build trust
- Move to Discord only when Telegram channel is genuinely too busy (>200 active members)

### Content Loops (Month 2+)
1. **Weekly vault insight:** "This week Limbo connected [X] to [Y] I'd forgotten"
2. **User spotlight:** Share how one real user structures their knowledge
3. **Changelog post:** What shipped each week (build credibility)

### Retention via Habit Design (in-product, Month 1-2)
- Telegram "morning note" suggestion: "3 ideas to process, 1 connection to make"
- Weekly digest: "Your vault grew by 12 notes. Here are 3 connections Limbo found."
- **This is the stickiness engine. Without it, users churn in week 2.**

---

## Key Metrics & Success Criteria (3-Month View)

### Acquisition
| Metric | Week 2 | Week 4 | Month 2 | Month 3 |
|--------|--------|--------|---------|---------|
| GitHub Stars | 300 | 800 | 2,000 | 3,500 |
| Active Users | 50 | 200 | 600 | 1,500 |
| Email List | 100 | 400 | 1,200 | 3,000 |
| Paid Users | 0 | 5 | 50 | 200 |

### Engagement (Make-or-Break Signals)
| Metric | Target | If missed |
|--------|--------|-----------|
| Week 2 retention | > 50% | Product problem — fix before launch |
| Week 6 retention | > 40% | Habit loop not working — fix onboarding |
| Free → Paid conversion | > 3% | Value gap — fix pitch or onboarding |
| Daily active / monthly active | > 30% | Users not returning — fix habit loop |

### Revenue
| Metric | Month 2 | Month 3 |
|--------|---------|---------|
| MRR | $500 | $2,500 |
| ARPU | $10/month | $10-12/month |
| Monthly churn | < 8% | < 6% |

---

## Budget Allocation (3-Month Sprint)

| Category | 3-Month Total | Notes |
|----------|--------------|-------|
| Infra (hosting, CI, limbo.app) | $200 | Minimal — self-hosted |
| Landing page design | $200 one-time | One page, done right |
| Newsletter outreach (1-2 placements) | $500 | Negotiated or traded |
| Community tools | $0 | Telegram free, Discord free |
| Content production | $0 | DIY, build-in-public |
| **Total** | **~$900** | Near-zero budget GTM |

If Relied Cloud partnership materializes with co-marketing support, some of this gets covered by the partnership.

---

## Competitive Response Playbook

If Obsidian adds native AI:
- Lean into MCP architecture and cross-platform agent access
- "Works with any LLM" vs single model lock-in
- Community data is already in Limbo vault — switching cost is real

If Anthropic ships local persistent memory for Claude:
- Position as the open, extensible layer that works *with* Claude via MCP
- Limbo + Claude = better together

If a well-funded startup enters:
- Speed. Ship weekly. Stay closer to users.
- Open-source moat + community loyalty
- Niche down harder: definitive tool for developers/researchers

---

*Sources: Market Research (LIM-25), Business Plan (LIM-26), Board direction (March 2026)*
