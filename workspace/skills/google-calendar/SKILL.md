# Google Calendar

When the user asks about their schedule, meetings, availability, or wants to create, modify, or delete events.

## Trigger

Any message about calendar, schedule, meetings, or time management. Examples:
- "qué tengo hoy?"
- "estoy libre mañana a las 3?"
- "agendame una reunión con X el jueves"
- "cambia la reunión de las 3 a las 4"
- "borrá el evento de las 5"
- "what's on my calendar this week?"

## Tools

You have **four** Google Calendar tools:

| Tool | Purpose |
|------|---------|
| `calendar_read` | List events for a date range |
| `calendar_create` | Create a new event |
| `calendar_update` | Modify an existing event (PATCH — only changed fields) |
| `calendar_delete` | Remove an event by id |

### `calendar_read`

List events for a date range. All params optional — defaults to today.

```json
{ "startDate": "2026-04-09", "endDate": "2026-04-10", "maxResults": 10 }
```

Returns: array of events with `id`, `summary`, `start`, `end`, `location`, `status`, `htmlLink`.

**The `id` field is what you need for `calendar_update` and `calendar_delete`.** Always read first when the user references an existing event by description ("la reunión de las 3", "el evento con Juan").

### `calendar_create`

Create a new event. Requires `title` and `startTime`.

```json
{
  "title": "Lunch with Alex",
  "startTime": "2026-04-09T12:00:00",
  "duration": 60,
  "description": "Catch up about the project",
  "location": "Café Roma",
  "timeZone": "America/Argentina/Buenos_Aires"
}
```

**CRITICAL — timezone handling**:
- Always read the user's `timeZone` from USER.md and pass it. This is not optional.
- If you skip `timeZone` AND the `startTime` has no offset, Google will interpret the time in UTC → event lands at the wrong local hour.
- Alternative: pass `startTime` with an explicit offset like `"2026-04-09T12:00:00-03:00"`. But passing `timeZone` is safer because it survives DST.

Returns: created event with `id`, `summary`, `start`, `end`, `htmlLink`.

### `calendar_update`

Modify an existing event. Only the fields you pass are changed (PATCH semantics). Requires `eventId`.

```json
{
  "eventId": "abc123",
  "startTime": "2026-04-09T16:00:00",
  "duration": 90,
  "timeZone": "America/Argentina/Buenos_Aires"
}
```

**To get the `eventId`**: call `calendar_read` first, find the matching event, and use its `id`.

- Only pass fields you want to change. Omit the rest.
- If you change `startTime`, pass `duration` and `timeZone` too (duration defaults to 60 min).
- `duration`-only updates are not supported — you must also pass `startTime`.

Returns: updated event with `id`, `summary`, `start`, `end`, `htmlLink`.

### `calendar_delete`

Permanently remove an event. Requires `eventId`.

```json
{ "eventId": "abc123" }
```

**This is irreversible.** Always confirm with the user before calling, and use `calendar_read` first to find the right event.

Returns: `{ "id": "abc123", "deleted": true }`.

## Steps

### When the user asks "what do I have"

1. Call `calendar_read` with the appropriate date range
2. Summarize events in chronological order (time, title, location)
3. Use the user's language and timezone

### When the user wants to schedule something

1. Extract title, time, duration, location from the message
2. Resolve relative dates ("mañana", "el jueves") to absolute dates
3. Read `timeZone` from USER.md
4. **Show the event details and ask for confirmation** ("¿Lo agendo?")
5. On confirmation → call `calendar_create`
6. Report back with a summary of what was created

### When the user wants to modify an event

1. Call `calendar_read` to find the matching event (filter by the user's description)
2. If multiple matches, ask which one
3. Extract the changes from the message
4. **Show the diff and confirm** ("Cambio esto: [old] → [new]. ¿OK?")
5. On confirmation → call `calendar_update` with the `eventId` and only the changed fields
6. Report back

### When the user wants to delete an event

1. Call `calendar_read` to find the matching event
2. If multiple matches, ask which one
3. **Confirm deletion explicitly** ("Borro '[title]' del [date] a las [time]? Esto no se puede deshacer.")
4. On confirmation → call `calendar_delete` with the `eventId`
5. Report back ("Listo, borré '[title]'")

## Rules

- **Always read USER.md first** to get the user's `timeZone` before calling `calendar_create` or `calendar_update` with time changes. Without it, events land at the wrong hour.
- Default duration is 60 minutes if not specified.
- Do NOT add attendees — v1 is personal events only.
- If the user says "mañana" or "el jueves", resolve to an actual date before calling the tool.
- When showing events, include free gaps if the user asks about availability.
- **Never delete without explicit confirmation.** "borrá el evento" → always ask first.
- **Never update without showing the diff.** "cambia la reunión" → show before/after first.
- Never fabricate events. If `calendar_read` returns empty, say so.
- When searching for an event to update/delete, be smart about matching: title keywords, approximate time, date. If unsure, ask the user to clarify.

## Errors

- **"Google Calendar is not connected"** → Tell the user: "Google Calendar no está conectado. Podés habilitarlo corriendo `limbo connect-calendar`."
- **Auth/token errors** → "Hubo un problema con la autenticación de Google Calendar. Probá reconectar con `limbo connect-calendar`."
- **API errors** → Report the error honestly. Don't retry silently.
- **Event not found** → If `calendar_delete` or `calendar_update` returns "not found", tell the user the event may have already been deleted or the id is stale.
