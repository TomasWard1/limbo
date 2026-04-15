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

- **Limbo Cloud.** Run `limbo cloud activate` to get a public URL for your instance (`https://{id}.heylimbo.com`). The setup wizard, connect-calendar, and switch-brain are all accessible from any browser — no SSH, no tunnels, no port forwarding. Run `limbo cloud deactivate` to go back to localhost mode.
- **Instant connect-calendar and switch-brain.** Both commands now take seconds instead of minutes. Limbo stays running the whole time — the wizard opens alongside the agent, and changes apply live.
- **One single `.env` file.** All tokens now live in `~/.limbo/config/.env`. Legacy secret files are migrated automatically.
- **No more tunnels.** All tunnel infrastructure (Cloudflare tunnels, localhost.run) has been removed. Access is either via public URL (cloud mode) or localhost (self-hosted, you manage SSH port-forwarding).

---

### Technical changelog

- feat(cloud): provisioning + OAuth relay Cloudflare Workers
- feat(supervisor): public server for Limbo Cloud instances (port 80, HTTP proxy to wizard)
- feat(cli): `limbo cloud activate/deactivate/status` commands
- feat(setup-server): OAuth relay mode — uses `auth.heylimbo.com` for Google OAuth when `LIMBO_PUBLIC_URL` is set
- feat(supervisor): wizard sidecar — on-demand wizards over a TCP control plane
- feat(cli): migrate `switch-brain` and `connect-calendar` to the control plane (no more container rebuild)
- fix(supervisor): set `OPENCLAW_NO_RESPAWN=1` — config reloads become in-process restarts
- feat(supervisor): enforce single active wizard session at a time (409 Conflict)
- feat(cli): SIGINT/SIGTERM cleanup cancels wizard session on Ctrl+C
- chore(cli): remove all tunnel code — cloud URL or localhost only
- fix(secrets): consolidate all tokens into `~/.limbo/config/.env`

## v1.30.0

- Limbo now notifies you when a new version is available
- You can update directly from Telegram with one tap
- Improved startup reliability

---

### Technical changelog
- feat: update notification system with wakeup routine
- feat: update_instance MCP tool + flag-file bridge to host
- feat: telegram-notify lib for deterministic system messages
