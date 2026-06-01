---
name: issue-triage
description: Use when deciding what to build next in Limbo, prioritizing GitHub issues, or asking "what should I ship". Combines impact analysis with fun factor using a 70/30 split. Triggers on "/issue-triage", "que construyo", "what should I build", "triage issues".
user-invocable: true
context: fork
model: sonnet
allowed-tools: Read, Grep, Glob, Bash, Agent, WebFetch
---

## EXECUTE NOW

You are triaging Limbo's GitHub issues to recommend what to build and ship next.

**Philosophy:** Building a product is 70% shipping what matters and 30% building what excites you. Burnout kills projects faster than bad prioritization. The fun stuff keeps the engine running.

---

### Step 1: Gather State

Run in parallel:

```bash
# Open issues with labels
gh issue list --repo TomasWard1/limbo --state open --limit 50 --json number,title,labels,createdAt,updatedAt

# PRs linking to issues (open PRs or merged into staging)
gh pr list --repo TomasWard1/limbo --state open --limit 50 --json number,title,headRefName,baseRefName
gh pr list --repo TomasWard1/limbo --state merged --base staging --limit 30 --json number,title,mergedAt

# Recent commits on staging (what's been shipped / is in flight)
git log staging --oneline -20

# Current branch work
git branch --show-current
git diff --stat HEAD~3..HEAD 2>/dev/null
```

Also read `ARCHITECTURE.md` to understand current capabilities (skip if already loaded this session).

---

### Step 1.5: Filter Already-Handled Issues

**Before scoring, remove issues that are already being worked on or shipped:**

1. **Has an open PR**: Check PR titles and branch names for issue numbers (e.g., `fix/243`, `feat/227`, `#243` in title). These are in-flight — exclude from triage.
2. **Merged into staging but not closed**: Some issues get fixed by a PR merged to staging but the issue stays open. Cross-reference merged PR titles/branches against issue numbers. Exclude these — they're shipping.
3. **Referenced in recent staging commits**: Check commit messages on staging for issue numbers (`#NNN`, `fix #NNN`, `closes #NNN`). Exclude.

If uncertain whether an issue is handled, mention it briefly in the output under a "Verify Status" section instead of scoring it.

---

### Step 2: Score Each Issue

For each open issue, assign two scores:

**Impact Score (0-10):** Weight 70%
| Factor | Weight | Questions |
|--------|--------|-----------|
| User pain | 3x | Is this blocking real usage? How many users hit this? |
| Revenue/growth | 2x | Does this unlock new users or use cases? |
| Bug severity | 2x | Data loss? Broken core flow? Cosmetic? |
| Dependency | 2x | Does this unblock other high-value work? |
| Size vs payoff | 1x | Small effort, big return? |

**Fun Score (0-10):** Weight 30%
| Factor | Questions |
|--------|-----------|
| Technical challenge | Is this interesting to build? New territory? |
| Demo-ability | Can you show this off? Does it make people go "whoa"? |
| Learning value | Does building this teach something transferable? |
| Creative freedom | Is there room to make something elegant? |
| Pride factor | Would you brag about this at a meetup? |

**Combined Score** = (Impact * 0.7) + (Fun * 0.3)

---

### Step 3: Select Top Picks

From the scored issues, pick ONLY:
- **Top 2-3 "Ship Now"** — highest combined score, or bugs with priority:high. Quick wins (size:small + impact >= 5) go here too.
- **Top 1-2 "Fun Pick"** — highest fun score. The thing you'd build on a Saturday because it's cool.
- **0-3 "Worth a Look"** — issues where you're not sure (needs verification, might be stale, ambiguous scope). Only include if genuinely uncertain.

**Do NOT list all issues.** The whole point is curation — if it didn't make the cut, it doesn't show up. The user can check the full issue list on GitHub.

---

### Step 4: Output

Keep it tight. No scores, no tables, no walls of text.

```
issue triage — {date}

  Ship Now:
    #{num} {title}
    → {1 line: why this, why now}

    #{num} {title}
    → {1 line}

  Fun Pick:
    #{num} {title}
    → {1 line: why this is fun to build}

  Worth a Look:
    #{num} {title} — {why you're unsure}

  {2-3 sentences: what YOU would do first and why, considering
  recent momentum and energy. Be opinionated.}
```

---

## Scoring Guidelines

**Avoid these traps:**
- Don't score integrations (Google Drive, Notion, etc.) high on impact unless there's evidence of user demand — they're often "nice to have" disguised as "must have"
- Bugs that affect core flows (vault, telegram, reminders) score higher than feature bugs
- "needs-design" label means the issue isn't ready to build — score lower on quick-win potential
- Don't let size:large scare you off high-impact work — sometimes the big thing IS the right thing

**The 30% fun rule:**
- If everything in "Ship Now" is boring infrastructure work, EXPLICITLY recommend taking one fun issue first to build energy
- If the user has been grinding bugs, say so: "you've been fixing bugs for a while, pick something fun"
- The fun score is not a tiebreaker — it's a first-class citizen in the decision

**Context matters:**
- If recent commits show a pattern (e.g., lots of bug fixes), recommend shifting gears
- If a feature area has momentum (recent work in that area), related issues get a boost
- Consider what's already half-built — finishing > starting new
