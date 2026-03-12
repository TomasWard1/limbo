# Competitive Comparison Table — Landing Page Ready

**Date:** March 2026
**Author:** Pepper Potts, CMO
**Purpose:** Data source for Limbo landing page comparison section

---

## Full Comparison Matrix

This table is designed to be adapted into a visual component on the landing page. Each row represents a differentiating feature. Limbo should be the leftmost column (hero position).

| Feature | Limbo | ChatGPT Memory | Claude Memory | Obsidian | Notion | Mem.ai | Memorae |
|---------|-------|---------------|--------------|----------|--------|--------|---------|
| **Your data stays on your machine** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Conversational interface** | ✅ | ✅ | ✅ | ❌ | ❌ | Partial | ✅ |
| **Structured knowledge base** | ✅ | ❌ | ❌ | ✅ | ✅ | Partial | ❌ |
| **Connected knowledge graph** | ✅ | ❌ | ❌ | Manual | Manual | ❌ | ❌ |
| **AI-powered semantic search** | ✅ | ✅ | ✅ | Plugin | Partial | ✅ | ❌ |
| **Works with any AI provider** | ✅ | ❌ | ❌ | Plugin | N/A | ❌ | N/A |
| **Self-hosted (Docker)** | ✅ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ |
| **Open source** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Data export / portability** | ✅ | ❌ | Partial | ✅ | ✅ | ❌ | ❌ |
| **Maps of Content (navigation)** | ✅ | ❌ | ❌ | Manual | Manual | ❌ | ❌ |
| **Cross-platform agent access (MCP)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Accessible via Telegram** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Simplified Version (Landing Page Hero)

For the above-the-fold section. Maximum 6 rows, punchy labels, binary comparison against the most relevant competitors.

| | Limbo | ChatGPT / Claude | Obsidian | Notion |
|---|:---:|:---:|:---:|:---:|
| **Your data, your machine** | ✅ | ❌ | ✅ | ❌ |
| **Just talk to it** | ✅ | ✅ | ❌ | ❌ |
| **Remembers & connects ideas** | ✅ | ❌ | Manual | Manual |
| **Works with any AI** | ✅ | ❌ | Plugin | ❌ |
| **Self-hosted & open source** | ✅ | ❌ | ❌ | ❌ |
| **Your data is exportable** | ✅ | ❌ | ✅ | ✅ |

---

## Positioning Statements (Copy Suggestions)

### Headline Options
1. "Your memory. Your machine. Your rules."
2. "ChatGPT forgets. Limbo remembers."
3. "The second brain that actually talks back."
4. "Stop re-explaining yourself to AI."

### Against ChatGPT/Claude Memory
> "ChatGPT Memory is for ChatGPT. Claude Memory is for Claude. **Limbo is for you.** Your knowledge follows you across any AI, lives on your machine, and never expires."

### Against Obsidian
> "Love Obsidian's privacy? So do we. Now imagine it could talk back, search semantically, and remember what you told it last week — without a single plugin."

### Against Notion
> "Notion is a workspace. Limbo is a brain. Talk to it, dump your ideas, and it connects the dots — all without your data leaving your machine."

### The "Good Enough" Objection
> "Sure, your ChatGPT chats *kind of* remember things. But can you search across them? Connect ideas? Export your knowledge? Access it from any AI? Own it forever? That's the difference between a chat log and a second brain."

---

## Pricing Context

| Tool | Price | What you get |
|------|-------|-------------|
| **Limbo** | Free (self-hosted) | Full features, bring your own API key |
| ChatGPT Plus | $20/mo | Memory included, cloud-only |
| Claude Pro | $20/mo | Memory included, cloud-only |
| Obsidian | Free + $4/mo sync | No AI, manual everything |
| Notion | $10/user/mo | Partial AI, cloud-only |
| Mem.ai | $10-12/mo | AI notes, cloud-only |
| Memorae | $2.99-8.99/mo | Reminders only, cloud-only |

**Limbo's pricing advantage:** Users already paying $20/month for ChatGPT or Claude get Limbo free on top — it enhances their existing AI subscription rather than replacing it. Limbo + Claude/ChatGPT > Claude/ChatGPT alone.

---

## Implementation Notes for Frontend

- Use the **Simplified Version** for the main landing page comparison section
- The **Full Comparison Matrix** can go on a dedicated `/compare` page
- Consider interactive toggle: "Compare Limbo vs [dropdown]" for 1:1 comparisons
- Mobile: collapse to 2-column (Limbo vs selected competitor)
- Use green checkmarks (✅) for Limbo, red X (❌) for missing features, yellow partial indicators
- Add tooltip/expandable for "Manual" and "Partial" entries explaining what they mean

---

*Sources: OpenAI Memory FAQ, Claude Help Center, tool pricing pages, DataIntelo PKM Market Report 2033 (all March 2026)*
