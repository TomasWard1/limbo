'use strict';

/**
 * Run assertions against captured eval data.
 *
 * @param {Array} assertions — from the case file
 * @param {{ response: string, mcpLogs: Array, vaultDiff: object }} data
 * @returns {Array<{ assertion: object, pass: boolean, reason: string }>}
 */
function score(assertions, { response, mcpLogs, vaultDiff }) {
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
function buildRegex(pattern) {
  let flags = '';
  let p = pattern;
  if (p.startsWith('(?i)')) {
    flags = 'i';
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
  const regex = new RegExp(assertion.pattern);
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
  const regex = new RegExp(assertion.pattern, 'i');
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
  const regex = new RegExp(pattern, 'i');
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

module.exports = { score };
