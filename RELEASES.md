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

## v1.30.0

- Limbo now notifies you when a new version is available
- You can update directly from Telegram with one tap
- Improved startup reliability

---

### Technical changelog
- feat: update notification system with wakeup routine
- feat: update_instance MCP tool + flag-file bridge to host
- feat: telegram-notify lib for deterministic system messages
