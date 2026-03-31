'use strict';

/**
 * Run assertions against captured eval data.
 *
 * @param {Array} assertions — from the case file
 * @param {{ response: string, mcpLogs: Array, vaultDiff: object }} data
 * @returns {Array<{ assertion: object, pass: boolean, reason: string }>}
 */
function score(assertions, { response, mcpLogs, vaultDiff, cronJobs, latencyMs, userProfile }) {
  return assertions.map((assertion) => {
    try {
      switch (assertion.type) {
        case 'tool_called':
          return checkToolCalled(assertion, mcpLogs);
        case 'param_match':
          return checkParamMatch(assertion, mcpLogs);
        case 'response_matches':
          return checkResponseMatches(assertion, response);
        case 'vault_note_created':
          return checkVaultNoteCreated(assertion, vaultDiff);
        case 'vault_file_exists':
          return checkVaultFileExists(assertion, vaultDiff);
        case 'cron_created':
          return checkCronCreated(assertion, cronJobs || []);
        case 'latency_under':
          return checkLatencyUnder(assertion, latencyMs);
        case 'response_no_error':
          return checkResponseNoError(assertion, response);
        case 'user_profile_matches':
          return checkUserProfileMatches(assertion, userProfile);
        default:
          return { assertion, pass: false, reason: `Unknown assertion type: ${assertion.type}` };
      }
    } catch (err) {
      return { assertion, pass: false, reason: `Error evaluating assertion: ${err.message}` };
    }
  });
}

/**
 * Build a RegExp, extracting inline (?i) flag into the JS 'i' flag.
 */
function buildRegex(pattern, defaultFlags) {
  let flags = defaultFlags || '';
  let p = pattern;
  if (p.startsWith('(?i)')) {
    flags = flags.includes('i') ? flags : flags + 'i';
    p = p.slice(4);
  }
  return new RegExp(p, flags);
}

function checkToolCalled(assertion, mcpLogs) {
  const called = mcpLogs.some(
    (log) => log.tool === assertion.tool && log.type === 'tool_call'
  );
  return {
    assertion,
    pass: called,
    reason: called
      ? `Tool "${assertion.tool}" was called`
      : `Tool "${assertion.tool}" was NOT called`,
  };
}

function checkParamMatch(assertion, mcpLogs) {
  const regex = buildRegex(assertion.pattern);
  const match = mcpLogs.some(
    (log) =>
      log.tool === assertion.tool &&
      log.type === 'tool_call' &&
      log.params &&
      regex.test(String(log.params[assertion.key] || ''))
  );
  return {
    assertion,
    pass: match,
    reason: match
      ? `Param "${assertion.key}" on "${assertion.tool}" matched /${assertion.pattern}/`
      : `Param "${assertion.key}" on "${assertion.tool}" did NOT match /${assertion.pattern}/`,
  };
}

function checkResponseMatches(assertion, response) {
  const regex = buildRegex(assertion.pattern);
  const pass = regex.test(response || '');
  return {
    assertion,
    pass,
    reason: pass
      ? `Response matched /${assertion.pattern}/`
      : `Response did NOT match /${assertion.pattern}/`,
  };
}

function checkVaultNoteCreated(assertion, vaultDiff) {
  const regex = buildRegex(assertion.pattern, 'i');
  const found = (vaultDiff.created || []).some(
    (f) => regex.test(f.path) || regex.test(f.content || '')
  );
  return {
    assertion,
    pass: found,
    reason: found
      ? `A created vault note matched /${assertion.pattern}/i`
      : `No created vault note matched /${assertion.pattern}/i`,
  };
}

function checkVaultFileExists(assertion, vaultDiff) {
  const pattern = assertion.pattern || assertion.path;
  if (!pattern) {
    return { assertion, pass: false, reason: 'vault_file_exists requires "pattern" or "path"' };
  }
  const regex = buildRegex(pattern, 'i');
  // Check both created and modified files
  const allFiles = [...(vaultDiff.created || []), ...(vaultDiff.modified || [])];
  const found = allFiles.some((f) => regex.test(f.path));
  return {
    assertion,
    pass: found,
    reason: found
      ? `Vault file matched /${pattern}/i`
      : `No vault file matched /${pattern}/i`,
  };
}

function checkCronCreated(assertion, cronJobs) {
  const pattern = assertion.pattern;
  if (!pattern) {
    return { assertion, pass: false, reason: 'cron_created requires "pattern"' };
  }
  const regex = buildRegex(pattern, 'i');
  const found = cronJobs.some((job) => regex.test(job.prompt || '') || regex.test(job.raw || ''));

  // Optional timezone check
  if (found && assertion.timezone) {
    const tzRegex = buildRegex(assertion.timezone, 'i');
    const tzMatch = cronJobs.some((job) => tzRegex.test(job.raw || ''));
    if (!tzMatch && assertion.local_hour != null) {
      const localMatch = cronJobs.some((job) =>
        cronMatchesLocalTime(job, assertion.timezone, assertion.local_hour, assertion.local_minute || 0)
      );
      if (localMatch) {
        return {
          assertion,
          pass: true,
          reason: `Cron matched "${pattern}" and resolves to ${assertion.local_hour}:${String(assertion.local_minute || 0).padStart(2, '0')} in ${assertion.timezone}`,
        };
      }
    }
    if (!tzMatch) {
      return {
        assertion,
        pass: false,
        reason: `Cron matched "${pattern}" but timezone "${assertion.timezone}" not found`,
      };
    }
  }

  return {
    assertion,
    pass: found,
    reason: found
      ? `Cron job matched /${pattern}/i`
      : `No cron job matched /${pattern}/i`,
  };
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
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour === expectedHour && minute === expectedMinute;
}

function checkLatencyUnder(assertion, latencyMs) {
  const maxMs = assertion.max_ms;
  if (!maxMs || typeof latencyMs !== 'number') {
    return { assertion, pass: false, reason: 'latency_under requires "max_ms" and latencyMs data' };
  }
  const pass = latencyMs <= maxMs;
  return {
    assertion,
    pass,
    reason: pass
      ? `Latency ${latencyMs}ms <= ${maxMs}ms`
      : `Latency ${latencyMs}ms EXCEEDED ${maxMs}ms`,
  };
}

function checkResponseNoError(assertion, response) {
  const errorPatterns = [
    /\b(error|failed|failure|exception)\b/i,
    /\b(could not|couldn't|cannot|can't)\s+(process|transcri|handle|receive)/i,
    /\b(no\s+(audio|file|document|transcription))\b/i,
    /\b(unsupported|invalid)\s+(file|format|type)/i,
  ];
  const matched = errorPatterns.find((rx) => rx.test(response || ''));
  const pass = !matched;
  return {
    assertion,
    pass,
    reason: pass
      ? 'Response does not contain error patterns'
      : `Response contains error pattern: ${matched}`,
  };
}

function checkUserProfileMatches(assertion, userProfile) {
  const pattern = assertion.pattern;
  if (!pattern) {
    return { assertion, pass: false, reason: 'user_profile_matches requires "pattern"' };
  }
  const regex = buildRegex(pattern, 'i');
  const pass = regex.test(userProfile || '');
  return {
    assertion,
    pass,
    reason: pass
      ? `USER.md matched /${pattern}/i`
      : `USER.md did NOT match /${pattern}/i`,
  };
}

module.exports = { score };
