// mcp-server/tools/google-calendar.js — Google Calendar MCP tools (gws CLI wrappers)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function ensureEnabled() {
  if (process.env.GOOGLE_CALENDAR_ENABLED !== 'true') {
    throw new Error(
      'Google Calendar is not connected. Enable it by running: limbo connect-calendar'
    );
  }
}

/**
 * Call gws CLI and return parsed JSON output.
 * gws reads credentials from GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE env var.
 *
 * cwd=/tmp: gws ALWAYS writes a side-file to cwd (e.g. "download.html" for
 * empty-body responses). On read-only root filesystems this fails with
 * "Failed to create output file". /tmp is a tmpfs in the hardened container.
 */
async function callGws(args) {
  const { stdout } = await execFileAsync('gws', args, {
    env: process.env,
    cwd: '/tmp',
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}

/**
 * Parse a startTime + duration into ISO start/end datetime strings.
 * Handles both offset-bearing ("2026-04-11T11:00:00-03:00") and floating
 * local-time ("2026-04-11T11:00:00") formats.
 *
 * @param {string} startTime - ISO datetime, with or without timezone offset
 * @param {number} durationMin - Duration in minutes
 * @returns {{ startDateTimeStr: string, endDateTimeStr: string }}
 */
function parseTimePair(startTime, durationMin) {
  const hasOffset = /[+-]\d{2}:\d{2}$|Z$/.test(startTime);

  if (hasOffset) {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    return { startDateTimeStr: start.toISOString(), endDateTimeStr: end.toISOString() };
  }

  // No offset — keep it as a "floating" local time and let Google interpret it
  // via the timeZone field. Compute end by parsing the local-time components.
  const m = startTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`Invalid startTime format: ${startTime}`);
  const [, y, mo, d, h, min, s] = m;
  const startMs = Date.UTC(+y, +mo - 1, +d, +h, +min, +(s || 0));
  const endMs = startMs + durationMin * 60 * 1000;
  const fmt = (ms) => {
    const dt = new Date(ms);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}T${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}:${String(dt.getUTCSeconds()).padStart(2, '0')}`;
  };
  return { startDateTimeStr: fmt(startMs), endDateTimeStr: fmt(endMs) };
}

/**
 * Call gws CLI for operations that return no body (HTTP 204, e.g. delete).
 * Skip JSON parsing — gws still writes a placeholder file but we don't read it.
 */
async function callGwsNoBody(args) {
  await execFileAsync('gws', args, {
    env: process.env,
    cwd: '/tmp',
    timeout: 30_000,
  });
}

/**
 * List Google Calendar events for a date range.
 * @param {object} opts
 * @param {string} [opts.startDate] - ISO date, defaults to today
 * @param {string} [opts.endDate] - ISO date, defaults to end of startDate
 * @param {number} [opts.maxResults] - max events, default 25
 * @returns {Promise<Array<{id: string, summary: string, start: string|null, end: string|null, location: string|null, status: string, htmlLink: string|null}>>}
 */
export async function calendarRead({ startDate, endDate, maxResults } = {}) {
  ensureEnabled();

  const now = new Date();
  // Default start = today at 00:00 (local time)
  const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Default end = start + 24h (full day of events).
  // If endDate is given and equals startDate (or is a bare date), extend to end-of-day
  // so the caller gets all events on that day, not an empty range.
  let end;
  if (endDate) {
    end = new Date(endDate);
    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }

  // Google Calendar API wants RFC 3339 timestamps
  const timeMin = start.toISOString();
  const timeMax = end.toISOString();
  const max = Math.min(maxResults || 25, 100);

  const params = {
    calendarId: 'primary',
    timeMin,
    timeMax,
    maxResults: max,
    singleEvents: true,
    orderBy: 'startTime',
  };

  const result = await callGws([
    'calendar', 'events', 'list',
    '--params', JSON.stringify(params),
    '--format', 'json',
  ]);

  // Map to simplified format
  const items = result.items || [];
  return items.map(ev => ({
    id: ev.id,
    summary: ev.summary || '(no title)',
    start: ev.start?.dateTime || ev.start?.date || null,
    end: ev.end?.dateTime || ev.end?.date || null,
    location: ev.location || null,
    status: ev.status || 'confirmed',
    htmlLink: ev.htmlLink || null,
  }));
}

/**
 * Create a Google Calendar event.
 * @param {object} opts
 * @param {string} opts.title - Event summary (required)
 * @param {string} opts.startTime - ISO datetime, with or without timezone offset (required)
 * @param {number} [opts.duration] - Minutes, default 60
 * @param {string} [opts.description] - Event description
 * @param {string} [opts.location] - Event location
 * @param {string} [opts.timeZone] - IANA timezone (e.g. "America/Argentina/Buenos_Aires").
 *   If the startTime has no offset, this tells Google how to interpret it.
 *   The agent should pass this from USER.md.
 * @returns {Promise<{id: string, summary: string, start: string, end: string, htmlLink: string|null}>}
 */
export async function calendarCreate({ title, startTime, duration, description, location, timeZone } = {}) {
  ensureEnabled();

  if (!title) throw new Error('title is required');
  if (!startTime) throw new Error('startTime is required');

  const { startDateTimeStr, endDateTimeStr } = parseTimePair(startTime, duration || 60);

  const event = {
    summary: title,
    start: { dateTime: startDateTimeStr },
    end: { dateTime: endDateTimeStr },
  };
  // If the agent provided a timeZone (from USER.md), pass it to Google so the
  // dateTime is interpreted correctly regardless of container clock.
  if (timeZone) {
    event.start.timeZone = timeZone;
    event.end.timeZone = timeZone;
  }
  if (description) event.description = description;
  if (location) event.location = location;

  const result = await callGws([
    'calendar', 'events', 'insert',
    '--params', JSON.stringify({ calendarId: 'primary' }),
    '--json', JSON.stringify(event),
    '--format', 'json',
  ]);

  return {
    id: result.id,
    summary: result.summary,
    start: result.start?.dateTime || result.start?.date,
    end: result.end?.dateTime || result.end?.date,
    htmlLink: result.htmlLink || null,
  };
}

/**
 * Delete a Google Calendar event by id.
 * @param {object} opts
 * @param {string} opts.eventId - The Google Calendar event id (from calendar_read)
 * @returns {Promise<{id: string, deleted: true}>}
 */
export async function calendarDelete({ eventId } = {}) {
  ensureEnabled();
  if (!eventId) throw new Error('eventId is required');

  // events.delete returns HTTP 204 No Content — no JSON body to parse.
  // Passing --format json triggers gws to create an output file on disk,
  // which fails on read-only filesystems.
  await callGwsNoBody([
    'calendar', 'events', 'delete',
    '--params', JSON.stringify({ calendarId: 'primary', eventId }),
  ]);

  return { id: eventId, deleted: true };
}

/**
 * Update an existing Google Calendar event by id. Only the provided fields
 * are changed (PATCH semantics).
 * @param {object} opts
 * @param {string} opts.eventId - Event id (required)
 * @param {string} [opts.title] - New title/summary
 * @param {string} [opts.startTime] - New start time (ISO, with or without offset)
 * @param {number} [opts.duration] - New duration in minutes (updates endTime relative to startTime)
 * @param {string} [opts.description] - New description
 * @param {string} [opts.location] - New location
 * @param {string} [opts.timeZone] - IANA timezone, passed from USER.md
 * @returns {Promise<{id: string, summary: string, start: string, end: string, htmlLink: string|null}>}
 */
export async function calendarUpdate({ eventId, title, startTime, duration, description, location, timeZone } = {}) {
  ensureEnabled();
  if (!eventId) throw new Error('eventId is required');

  const patch = {};
  if (title) patch.summary = title;
  if (description) patch.description = description;
  if (location) patch.location = location;

  if (startTime) {
    const { startDateTimeStr, endDateTimeStr } = parseTimePair(startTime, duration || 60);

    patch.start = { dateTime: startDateTimeStr };
    patch.end = { dateTime: endDateTimeStr };
    if (timeZone) {
      patch.start.timeZone = timeZone;
      patch.end.timeZone = timeZone;
    }
  } else if (duration) {
    // Duration change without startTime change: we'd need to read the current event
    // first to compute the new end. Not supported yet — require startTime for now.
    throw new Error('duration-only updates are not supported yet; pass startTime too');
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('No fields to update. Provide at least one of: title, startTime, description, location.');
  }

  const result = await callGws([
    'calendar', 'events', 'patch',
    '--params', JSON.stringify({ calendarId: 'primary', eventId }),
    '--json', JSON.stringify(patch),
    '--format', 'json',
  ]);

  return {
    id: result.id,
    summary: result.summary,
    start: result.start?.dateTime || result.start?.date,
    end: result.end?.dateTime || result.end?.date,
    htmlLink: result.htmlLink || null,
  };
}
