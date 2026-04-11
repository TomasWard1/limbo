# Limbo Releases

> User-facing changelog. The section for the latest version (above the first `---`)
> is sent to users as the update notification in Telegram. Keep it non-technical
> and human-readable. Technical details go below the `---` separator.
>
> Format:
> ```
> ## vX.Y.Z
>
> - Human-readable change 1
> - Human-readable change 2
>
> ---
>
> ### Technical changelog
> - feat: technical description (#PR)
> - fix: technical description (#PR)
> ```

## Next release

- **Instant connect-calendar and switch-brain.** Both commands used to tear down the container, rebuild the image, and start a fresh setup wizard — that easily took 5–20 minutes. Now they take a few seconds: Limbo stays running the whole time, the wizard opens in a new window, and your changes apply live.
- **One single `.env` file.** All tokens (LLM key, Telegram, voice, search, Google) now live in `~/.limbo/config/.env`. Legacy secret files from older installs are migrated automatically on first start after this update — nothing for you to do.
- **Cloudflare tunnel self-heals.** If a previous `limbo connect-calendar` left a dangling tunnel on your Cloudflare account, `limbo update` cleans it up. Also blocks the case where the tunnel DNS landed in the wrong zone.

### Heads up — **if you already had Google Calendar connected**

You need to add one new URL to your Google OAuth client (one-time, ~30 seconds):

1. Open <https://console.cloud.google.com/apis/credentials>
2. Click the OAuth 2.0 Client ID you use for Limbo
3. Under **Authorized redirect URIs**, add: `http://localhost:18790/auth/google/callback`
   (if you use a custom `LIMBO_PORT`, use `<LIMBO_PORT + 1>` instead of 18790)
4. Save

Until you do this, `limbo connect-calendar` will fail with `redirect_uri_mismatch`. Existing connections keep working — this is only needed if you re-run connect-calendar.

---

### Technical changelog

- feat(supervisor): wizard sidecar — on-demand wizards over a TCP control plane
- feat(cli): migrate `switch-brain` and `connect-calendar` to the control plane (no more container rebuild)
- feat(supervisor): control-plane HTTP API bound to 127.0.0.1:LIMBO_PORT+2 with Host-header allowlist
- fix(supervisor): set `OPENCLAW_NO_RESPAWN=1` on the OpenClaw child so config reloads become in-process restarts (no fork+exec, no port collisions)
- fix(supervisor): respawn OpenClaw on clean exit with a sliding-window crash-loop guard (5 restarts / 60 s)
- feat(supervisor): enforce single active wizard session at a time (409 Conflict on concurrent POST /wizard)
- feat(cli): install SIGINT/SIGTERM cleanup so Ctrl+C during a wizard cancels the session on the supervisor
- fix(setup-server): honour `SETUP_TOKEN` injected by the supervisor (was generating a mismatched token)
- fix(secrets): consolidate all tokens into `~/.limbo/config/.env`; drop `/run/secrets` and `~/.limbo/secrets/`
- fix(cli): cloudflare tunnel self-heal via blocking DNS check + stale-tunnel sweep on start

## v1.30.0

- Limbo now notifies you when a new version is available
- You can update directly from Telegram with one tap
- Improved startup reliability

---

### Technical changelog
- feat: update notification system with wakeup routine
- feat: update_instance MCP tool + flag-file bridge to host
- feat: telegram-notify lib for deterministic system messages
