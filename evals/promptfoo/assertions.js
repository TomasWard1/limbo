'use strict';

/**
 * Custom assertion functions for Limbo promptfoo evals.
 *
 * Each exported function receives (output, context) and returns { pass, score, reason }.
 * The provider attaches mcpLogs, cronJobs, userProfile, and latencyMs to context.metadata.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

function buildRegex(pattern, defaultFlags) {
  let flags = defaultFlags || '';
  let p = pattern;
  if (p.startsWith('(?i)')) {
    flags = flags.includes('i') ? flags : flags + 'i';
    p = p.slice(4);
  }
  return new RegExp(p, flags);
}

function getConfig(context) {
  return context.config || {};
}

function getMeta(context) {
  return context.providerResponse?.metadata || {};
}

// ── Assertions ─────────────────────────────────────────────────────────────

/**
 * Check that a specific MCP tool was called.
 * Usage in promptfooconfig:
 *   type: javascript
 *   value: file://assertions.js:toolCalled
 *   config: { tool: "vault_write_note" }
 */
function toolCalled(output, context) {
  const { tool } = getConfig(context);
  const { mcpLogs = [] } = getMeta(context);
  const called = mcpLogs.some(log => log.tool === tool && log.type === 'tool_call');
  return {
    pass: called,
    score: called ? 1 : 0,
    reason: called ? `Tool "${tool}" was called` : `Tool "${tool}" was NOT called`,
  };
}

/**
 * Check that a tool parameter matches a regex pattern.
 * config: { tool, key, pattern }
 */
function paramMatch(output, context) {
  const { tool, key, pattern } = getConfig(context);
  const { mcpLogs = [] } = getMeta(context);
  const regex = buildRegex(pattern);
  const match = mcpLogs.some(
    log => log.tool === tool && log.type === 'tool_call' && log.params && regex.test(String(log.params[key] || ''))
  );
  return {
    pass: match,
    score: match ? 1 : 0,
    reason: match
      ? `Param "${key}" on "${tool}" matched /${pattern}/`
      : `Param "${key}" on "${tool}" did NOT match /${pattern}/`,
  };
}

/**
 * Check that the response matches a regex pattern.
 * config: { pattern }
 */
function responseMatches(output, context) {
  const { pattern } = getConfig(context);
  const regex = buildRegex(pattern);
  const pass = regex.test(output || '');
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? `Response matched /${pattern}/` : `Response did NOT match /${pattern}/`,
  };
}

/**
 * Check that USER.md matches a pattern.
 * config: { pattern }
 */
function userProfileMatches(output, context) {
  const { pattern } = getConfig(context);
  const { userProfile = '' } = getMeta(context);
  const regex = buildRegex(pattern, 'i');
  const pass = regex.test(userProfile);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? `USER.md matched /${pattern}/i` : `USER.md did NOT match /${pattern}/i`,
  };
}

/**
 * Check that a cron job was created matching a pattern.
 * config: { pattern, timezone?, local_hour?, local_minute? }
 */
function cronCreated(output, context) {
  const { pattern, timezone, local_hour, local_minute } = getConfig(context);
  const { cronJobs = [] } = getMeta(context);
  const regex = buildRegex(pattern, 'i');
  const found = cronJobs.some(job => regex.test(job.prompt || '') || regex.test(job.raw || ''));

  if (!found) {
    return { pass: false, score: 0, reason: `No cron job matched /${pattern}/i` };
  }

  if (timezone && local_hour != null) {
    const localMatch = cronJobs.some(job => cronMatchesLocalTime(job, timezone, local_hour, local_minute || 0));
    if (localMatch) {
      return {
        pass: true,
        score: 1,
        reason: `Cron matched "${pattern}" at ${local_hour}:${String(local_minute || 0).padStart(2, '0')} in ${timezone}`,
      };
    }
    return { pass: false, score: 0, reason: `Cron matched "${pattern}" but wrong time for ${timezone}` };
  }

  return { pass: true, score: 1, reason: `Cron job matched /${pattern}/i` };
}

function cronMatchesLocalTime(job, timezone, expectedHour, expectedMinute) {
  const raw = job?.raw || job?.schedule || '';
  const match = raw.match(/at:\s*([0-9T:\-.]+Z)/i);
  if (!match) return false;

  const dt = new Date(match[1]);
  if (Number.isNaN(dt.getTime())) return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(dt);
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  return hour === expectedHour && minute === expectedMinute;
}

/**
 * Check that exactly N new notes were created in the vault, and optionally
 * that the note filename matches a pattern (accent-insensitive).
 * config: { count?, pattern? }
 */
function vaultNoteCreated(output, context) {
  const { count = 1, pattern } = getConfig(context);
  const { notesBefore = [], notesAfter = [] } = getMeta(context);
  const beforeSet = new Set(notesBefore);
  const newNotes = notesAfter.filter(n => !beforeSet.has(n));

  if (newNotes.length !== count) {
    return {
      pass: false,
      score: 0,
      reason: `Expected ${count} new note(s), got ${newNotes.length}. New: ${newNotes.join(', ') || 'none'}`,
    };
  }

  if (pattern) {
    // Normalize accents for matching (maní → mani, etc.)
    const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const regex = buildRegex(normalize(pattern), 'i');
    const match = newNotes.some(n => regex.test(normalize(n)));
    if (!match) {
      return {
        pass: false,
        score: 0,
        reason: `New note(s) [${newNotes.map(n => n.split('/').pop()).join(', ')}] did not match /${pattern}/ (accent-normalized)`,
      };
    }
  }

  return {
    pass: true,
    score: 1,
    reason: `${newNotes.length} new note(s) created${pattern ? ` matching /${pattern}/` : ''}: ${newNotes.map(n => n.split('/').pop()).join(', ')}`,
  };
}

/**
 * Check that the cron job count increased by exactly N.
 * config: { by: 1 }
 */
function cronCountIncreased(output, context) {
  const { by = 1 } = getConfig(context);
  const { cronJobsBefore = [], cronJobsAfter = [] } = getMeta(context);
  const diff = cronJobsAfter.length - cronJobsBefore.length;
  const pass = diff === by;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Cron count increased by ${diff} (${cronJobsBefore.length} → ${cronJobsAfter.length})`
      : `Expected cron count to increase by ${by}, got ${diff} (${cronJobsBefore.length} → ${cronJobsAfter.length})`,
  };
}

module.exports = {
  toolCalled,
  paramMatch,
  responseMatches,
  userProfileMatches,
  cronCreated,
  cronCountIncreased,
  vaultNoteCreated,
};
