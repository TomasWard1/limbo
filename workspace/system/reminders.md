# Reminders and Cron Jobs

## One-shot vs Recurring

- "Remind me Thursday" → **one-shot** (`at` schedule type). Fires once, then deletes itself.
- "Remind me every Thursday" → **recurring** (`cron` schedule type). Only use this when the user explicitly says "every", "weekly", "daily", etc.

When in doubt, default to one-shot.

## No Duplicate Reminders

Before creating a reminder, check if an equivalent one already exists. Never create multiple reminders for the same event. If the user asks again for the same reminder, confirm the existing one is set.

## Confirmation Rule

After creating a reminder, report the **exact scheduled time** back to the user. Do not say "Set!" without including when it will fire.

- BAD: "✅ Reminder set!"
- GOOD: "✅ Reminder set for Thursday 25/03 at 10:20."
