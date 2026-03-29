// === Limbo Eval Dashboard ===

const state = {
  latest: null,
  baseline: null,
  baselinesIndex: {},
  cases: [],
  history: [],
  caseMap: {},
  runCache: {},
  profiles: [],
  selectedProfile: null,
  expandedCase: null,
  expandedRun: null,
};

async function api(path) {
  const res = await fetch(`/api/${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function init() {
  const [latest, baseline, baselinesIndex, cases, history] = await Promise.all([
    api('latest'),
    api('baseline'),
    api('baselines-index'),
    api('cases'),
    api('history'),
  ]);

  state.latest = latest ? normalizeRun(latest) : null;
  state.baseline = baseline ? normalizeRun(baseline) : null;
  state.baselinesIndex = baselinesIndex || {};
  state.cases = cases;
  state.history = (history || []).map(normalizeRunSummary);
  state.caseMap = {};
  state.cases.forEach(c => { state.caseMap[c.name] = c; });
  state.profiles = collectProfiles();

  if (state.latest) state.runCache[state.latest.id] = state.latest;
  if (state.baseline) state.runCache[state.baseline.id] = state.baseline;

  initializeSelectionState();
  setupNav();
  setupControls();
  renderNavMeta();
  renderAll();
}

function normalizeRun(run) {
  const meta = normalizeMeta(run.meta);
  return {
    ...run,
    meta,
    kind: deriveRunKind(run),
  };
}

function normalizeRunSummary(run) {
  const meta = normalizeMeta(run.meta);
  return {
    ...run,
    meta,
    kind: run.kind || deriveRunKind(run),
  };
}

function normalizeMeta(meta) {
  meta = meta || {};
  const provider = meta.provider || 'unknown-provider';
  const model = meta.model || 'unknown-model';
  const reasoningEffort = meta.reasoningEffort || 'default';
  return {
    ...meta,
    provider,
    model,
    reasoningEffort,
    profileKey: meta.profileKey || [provider, model, reasoningEffort].join('__').replace(/[^a-zA-Z0-9._-]+/g, '-'),
    profileLabel: meta.profileLabel || `${model} · ${reasoningEffort} · ${provider}`,
  };
}

function deriveRunKind(run) {
  if (run.kind) return run.kind;
  if (run.scope?.tag === 'speed') return 'speed';
  if (run.scope?.case || run.scope?.difficulty || run.scope?.tag) return 'subset';
  return 'full';
}

function pct(n) { return `${Math.round(n * 100)}%`; }
function statusOf(passRate) { return passRate >= 1 ? 'pass' : passRate > 0 ? 'partial' : 'fail'; }
function statusIcon(passRate) { return passRate >= 1 ? '\u2713' : passRate > 0 ? '\u25D0' : '\u2717'; }

function formatDate(ts) {
  if (!ts) return '\u2014';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function shortDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function barColor(rate) {
  if (rate >= 0.9) return 'var(--green)';
  if (rate >= 0.7) return 'var(--amber)';
  return 'var(--red)';
}

function isSpeedCase(caseName) {
  const def = state.caseMap[caseName];
  if (!def || !def.tags) return false;
  return def.tags.includes('speed') || def.tags.includes('vault_search');
}

function createEl(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') el.className = v;
      else if (k === 'textContent') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v);
    });
  }
  if (children) {
    if (typeof children === 'string') el.textContent = children;
    else if (Array.isArray(children)) children.forEach(c => { if (c) el.appendChild(c); });
    else el.appendChild(children);
  }
  return el;
}

function difficultyPill(d) {
  const el = document.createElement('span');
  el.className = `pill pill-${d || 'neutral'}`;
  el.textContent = d || '?';
  return el;
}

function statusPill(s) {
  const el = document.createElement('span');
  el.className = `pill pill-${s}`;
  el.textContent = s;
  return el;
}

function metaBadge(text) {
  return createEl('span', { className: 'meta-badge' }, text);
}

function formatLatencyMs(latencyMs) {
  return typeof latencyMs === 'number' ? `${(latencyMs / 1000).toFixed(1)}s` : '—';
}

function summarizeToolParams(params) {
  if (!params || typeof params !== 'object') return '';
  const pairs = Object.entries(params)
    .slice(0, 3)
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${text.length > 80 ? `${text.slice(0, 77)}...` : text}`;
    });
  return pairs.join(' · ');
}

function buildToolTrace(logs) {
  if (!Array.isArray(logs) || !logs.length) return null;
  const wrap = createEl('div', { className: 'tool-trace-list' });
  logs.forEach(log => {
    const row = createEl('div', { className: 'tool-trace-row' });
    const typeLabel = log.type === 'tool_call' ? 'call' : log.type === 'tool_result' ? 'result' : log.type || 'log';
    row.appendChild(metaBadge(typeLabel));
    row.appendChild(createEl('div', { className: 'tool-trace-tool' }, log.tool || 'unknown-tool'));
    const detailParts = [];
    if (log.type === 'tool_result' && typeof log.success === 'boolean') {
      detailParts.push(log.success ? 'ok' : 'error');
    }
    const paramsSummary = summarizeToolParams(log.params);
    if (paramsSummary) detailParts.push(paramsSummary);
    if (log.timestamp) detailParts.push(shortDate(log.timestamp));
    row.appendChild(createEl('div', { className: 'tool-trace-detail' }, detailParts.join(' · ')));
    wrap.appendChild(row);
  });
  return wrap;
}

function buildTranscriptSection(result) {
  const section = createEl('div', { className: 'detail-section' });
  const steps = Array.isArray(result.steps) ? result.steps : [];
  const hasTranscript = steps.some(step => step.input || step.response);

  section.appendChild(createEl('h3', {}, steps.length > 1 ? 'Conversation' : 'LLM Response'));

  if (hasTranscript) {
    const transcript = createEl('div', { className: 'transcript-list' });
    steps.forEach(step => {
      const card = createEl('div', { className: 'step-card' });
      const header = createEl('div', { className: 'step-header' });
      header.appendChild(createEl('div', { className: 'step-title' }, `Step ${step.index || 1}`));
      header.appendChild(createEl('div', { className: 'step-meta' }, `${formatLatencyMs(step.latencyMs)} · ${step.scoreResults?.filter(r => r.pass).length || 0}/${step.scoreResults?.length || 0}`));
      card.appendChild(header);

      if (step.input) {
        const userTurn = createEl('div', { className: 'transcript-turn user' });
        userTurn.appendChild(createEl('div', { className: 'transcript-speaker' }, 'User'));
        userTurn.appendChild(createEl('div', { className: 'response-box' }, step.input));
        card.appendChild(userTurn);
      }

      if (step.response) {
        const assistantTurn = createEl('div', { className: 'transcript-turn assistant' });
        assistantTurn.appendChild(createEl('div', { className: 'transcript-speaker' }, 'Assistant'));
        assistantTurn.appendChild(createEl('div', { className: 'response-box' }, step.response));
        card.appendChild(assistantTurn);
      }

      const stepTrace = buildToolTrace(step.mcpLogs);
      if (stepTrace) {
        card.appendChild(createEl('div', { className: 'transcript-speaker' }, 'Tools'));
        card.appendChild(stepTrace);
      }

      card.appendChild(buildStepAssertions(step));
      transcript.appendChild(card);
    });
    section.appendChild(transcript);
    return section;
  }

  section.appendChild(createEl('div', { className: 'response-box', textContent: result.response || '(no response captured)' }));
  if (result.mcpLogs?.length) {
    section.appendChild(createEl('div', { className: 'detail-note' }, 'Legacy run: no transcript was stored. Showing tool trace only.'));
    const trace = buildToolTrace(result.mcpLogs);
    if (trace) section.appendChild(trace);
  }
  return section;
}

function buildStepAssertions(step) {
  const wrap = createEl('div', { className: 'step-assertions' });
  const results = Array.isArray(step.scoreResults) ? step.scoreResults : [];
  if (!results.length) return wrap;

  wrap.appendChild(createEl('div', { className: 'transcript-speaker' }, `Assertions (${results.filter(r => r.pass).length}/${results.length})`));
  results.forEach(sr => {
    const row = createEl('div', { className: 'assertion-row compact' });
    row.appendChild(createEl('div', { className: `assertion-icon ${sr.pass ? 'pass' : 'fail'}` }, sr.pass ? '\u2713' : '\u2717'));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'assertion-type' }, sr.assertion.type + (sr.assertion.tool ? ` \u2192 ${sr.assertion.tool}` : '')));
    info.appendChild(createEl('div', { className: 'assertion-reason' }, sr.reason));
    row.appendChild(info);
    wrap.appendChild(row);
  });
  return wrap;
}

function collectProfiles() {
  const map = new Map();
  const runs = [];
  if (state.latest) runs.push(state.latest);
  if (state.baseline) runs.push(state.baseline);
  state.history.forEach(r => runs.push(r));
  Object.values(state.baselinesIndex || {}).forEach(entry => {
    Object.values(entry || {}).forEach(candidate => {
      if (candidate?.profileKey && candidate?.profileLabel) {
        map.set(candidate.profileKey, candidate.profileLabel);
      }
    });
  });
  runs.forEach(r => map.set(r.meta.profileKey, r.meta.profileLabel));
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function initializeSelectionState() {
  state.selectedProfile = state.latest?.meta.profileKey || state.profiles[0]?.key || null;
}

function getLatestRunForProfile(profileKey) {
  const runs = state.history
    .filter(r => r.meta.profileKey === profileKey)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  // Prefer full runs for accuracy/speed extraction
  const full = runs.filter(r => r.kind === 'full');
  return full.length ? full[0] : runs[0] || null;
}

function getRunsForProfile(profileKey) {
  return state.history
    .filter(r => r.meta.profileKey === profileKey)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function getRunById(runId) {
  if (!runId) return null;
  if (state.runCache[runId]) return state.runCache[runId];
  const run = normalizeRun(await api(`run/${runId}`));
  state.runCache[runId] = run;
  return run;
}

function getSelectedProfileLabel() {
  return state.profiles.find(p => p.key === state.selectedProfile)?.label || 'unknown-model';
}

function formatRunOption(run) {
  const totalPassed = run.totalPassed ?? run.results?.reduce((s, r) => s + r.passed, 0) ?? 0;
  const totalAssertions = run.totalAssertions ?? run.results?.reduce((s, r) => s + r.total, 0) ?? 0;
  const rate = totalAssertions ? totalPassed / totalAssertions : 0;
  const kindLabel = run.kind || 'full';
  return `${run.meta.profileLabel} \u00B7 ${kindLabel} \u00B7 ${pct(rate)} \u00B7 ${shortDate(run.timestamp)}`;
}

function renderNavMeta() {
  const navMeta = document.getElementById('nav-meta');
  navMeta.replaceChildren();
}

function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
}

function showView(viewId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  const tab = document.querySelector(`[data-view="${viewId}"]`);
  if (tab) tab.classList.add('active');
}

function setupControls() {
  const profileSelect = document.getElementById('profile-select');
  profileSelect.replaceChildren(...state.profiles.map(p => createEl('option', { value: p.key }, p.label)));
  profileSelect.value = state.selectedProfile;
  profileSelect.addEventListener('change', () => {
    state.selectedProfile = profileSelect.value;
    renderNavMeta();
    renderAll();
  });

  document.getElementById('compare-btn').addEventListener('click', doCompare);
}

function renderAll() {
  renderAccuracy();
  renderSpeed();
  renderCompareSelectors();
  renderHistory();
  setupFilters();
}

function setupFilters() {
  const diffFilter = document.getElementById('filter-difficulty');
  const statusFilter = document.getElementById('filter-status');
  const searchFilter = document.getElementById('filter-search');

  if (diffFilter.dataset.bound) return;
  diffFilter.dataset.bound = '1';

  const applyFilters = async () => {
    const latestSummary = getLatestRunForProfile(state.selectedProfile);
    if (!latestSummary) return;
    const run = await getRunById(latestSummary.id);
    if (!run) return;
    let results = [...run.results];

    const diff = diffFilter.value;
    if (diff) {
      results = results.filter(r => {
        const c = state.caseMap[r.case];
        return c && c.difficulty === diff;
      });
    }

    const status = statusFilter.value;
    if (status) {
      results = results.filter(r => statusOf(r.passRate) === status);
    }

    const search = searchFilter.value.toLowerCase();
    if (search) {
      results = results.filter(r => r.case.toLowerCase().includes(search));
    }

    renderResultsList(results);
  };

  diffFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  searchFilter.addEventListener('input', applyFilters);
}

// === ACCURACY TAB ===

async function renderAccuracy() {
  const latestSummary = getLatestRunForProfile(state.selectedProfile);
  if (!latestSummary) {
    document.getElementById('accuracy-run-id').textContent = 'No runs for this profile';
    document.getElementById('accuracy-stats').replaceChildren();
    document.getElementById('accuracy-difficulty').replaceChildren();
    document.getElementById('accuracy-results').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No runs for this profile')])
    );
    return;
  }

  const run = await getRunById(latestSummary.id);
  if (!run) return;

  document.getElementById('accuracy-run-id').textContent =
    `${run.id} \u2014 ${run.meta.profileLabel} \u2014 ${formatDate(run.timestamp)}`;

  const totalPassed = run.results.reduce((s, r) => s + r.passed, 0);
  const totalAssertions = run.results.reduce((s, r) => s + r.total, 0);
  const overallRate = totalAssertions ? totalPassed / totalAssertions : 0;
  const casesFullPass = run.results.filter(r => r.passRate >= 1).length;
  const casesFailed = run.results.filter(r => r.passRate < 1).length;

  document.getElementById('accuracy-stats').replaceChildren(
    buildStatCard('Pass Rate', pct(overallRate), statusOf(overallRate), `${totalPassed}/${totalAssertions} assertions`),
    buildStatCard('Cases', String(run.results.length), 'neutral', `${casesFullPass} passed, ${casesFailed} partial/fail`),
    buildStatCard('Run Kind', run.kind, 'neutral', formatDate(run.timestamp)),
  );

  const byDiff = {};
  run.results.forEach(r => {
    const caseDef = state.caseMap[r.case];
    const diff = caseDef ? caseDef.difficulty : 'unknown';
    if (!byDiff[diff]) byDiff[diff] = { passed: 0, total: 0, cases: 0 };
    byDiff[diff].passed += r.passed;
    byDiff[diff].total += r.total;
    byDiff[diff].cases++;
  });

  const diffOrder = ['easy', 'medium', 'hard'];
  document.getElementById('accuracy-difficulty').replaceChildren(
    ...diffOrder.filter(d => byDiff[d]).map(d => {
      const b = byDiff[d];
      const rate = b.total ? b.passed / b.total : 0;
      const card = createEl('div', { className: 'difficulty-card' });
      const header = createEl('div', { className: 'difficulty-header' });
      const label = createEl('span', { className: 'difficulty-label' });
      label.appendChild(difficultyPill(d));
      label.appendChild(document.createTextNode(` ${b.cases} cases`));
      header.appendChild(label);
      header.appendChild(createEl('span', { className: `difficulty-rate ${statusOf(rate)}`, textContent: pct(rate) }));
      card.appendChild(header);
      const bar = createEl('div', { className: 'progress-bar' });
      const fill = createEl('div', { className: `progress-fill ${statusOf(rate)}` });
      fill.style.width = `${rate * 100}%`;
      bar.appendChild(fill);
      card.appendChild(bar);
      return card;
    })
  );

  renderResultsList(run.results);
}

function buildStatCard(label, value, status, sub) {
  const card = createEl('div', { className: 'stat-card' });
  card.appendChild(createEl('div', { className: 'stat-label' }, label));
  card.appendChild(createEl('div', { className: `stat-value ${status}` }, value));
  card.appendChild(createEl('div', { className: 'stat-sub' }, sub));
  return card;
}

function renderResultsList(results) {
  const container = document.getElementById('accuracy-results');
  const children = [];

  results.forEach(r => {
    const caseDef = state.caseMap[r.case];
    const diff = caseDef ? caseDef.difficulty : '?';
    const status = statusOf(r.passRate);

    const row = createEl('div', { className: 'result-row', 'data-case': r.case });
    row.appendChild(createEl('div', { className: `result-icon ${status}` }, statusIcon(r.passRate)));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'result-name' }, r.case));
    row.appendChild(info);
    row.appendChild(difficultyPill(diff));
    row.appendChild(createEl('div', { className: `result-score ${status}` }, `${r.passed}/${r.total}`));
    row.appendChild(createEl('div', { className: 'result-latency' }, typeof r.latencyMs === 'number' ? `${(r.latencyMs / 1000).toFixed(1)}s` : ''));
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => toggleAccordion(container, r.case, r, row));
    children.push(row);
  });

  container.replaceChildren(...children);
}

function toggleAccordion(container, caseName, result, rowEl) {
  const existing = container.querySelector('.accordion-detail');
  const wasOpen = existing && existing.dataset.case === caseName;
  if (existing) existing.remove();

  if (wasOpen) {
    state.expandedCase = null;
    return;
  }

  state.expandedCase = caseName;
  const detail = buildAccordionDetail(caseName, result);
  detail.dataset.case = caseName;
  rowEl.after(detail);
}

function buildAccordionDetail(caseName, result) {
  const el = createEl('div', { className: 'accordion-detail' });

  const assertSection = createEl('div', { className: 'detail-section' });
  assertSection.appendChild(createEl('h3', {}, `Assertions (${result.passed}/${result.total})`));
  result.scoreResults.forEach(sr => {
    const row = createEl('div', { className: 'assertion-row' });
    row.appendChild(createEl('div', { className: `assertion-icon ${sr.pass ? 'pass' : 'fail'}` }, sr.pass ? '\u2713' : '\u2717'));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'assertion-type' }, sr.assertion.type + (sr.assertion.tool ? ` \u2192 ${sr.assertion.tool}` : '')));
    info.appendChild(createEl('div', { className: 'assertion-reason' }, sr.reason));
    row.appendChild(info);
    assertSection.appendChild(row);
  });
  el.appendChild(assertSection);
  el.appendChild(buildTranscriptSection(result));

  if (result.vaultDiff) {
    const vaultSection = createEl('div', { className: 'detail-section' });
    vaultSection.appendChild(createEl('h3', {}, 'Vault Changes'));
    const vaultDiff = createEl('div', { className: 'vault-diff' });
    ['created', 'modified', 'deleted'].forEach(key => {
      const item = createEl('div', { className: `vault-diff-item ${key}` });
      item.appendChild(createEl('span', { className: 'count' }, String(result.vaultDiff[key])));
      item.appendChild(document.createTextNode(` ${key}`));
      vaultDiff.appendChild(item);
    });
    vaultSection.appendChild(vaultDiff);
    el.appendChild(vaultSection);
  }

  return el;
}

// === SPEED TAB ===
// Extracts speed cases from ANY run that contains them (not filtered by kind === 'speed')

async function renderSpeed() {
  const latestSummary = getLatestRunForProfile(state.selectedProfile);
  if (!latestSummary) {
    document.getElementById('speed-run-id').textContent = 'No runs for this profile';
    document.getElementById('speed-stats').replaceChildren();
    document.getElementById('speed-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No runs for this profile')])
    );
    document.getElementById('speed-results').replaceChildren();
    return;
  }

  const run = await getRunById(latestSummary.id);
  if (!run) return;

  const speedResults = run.results.filter(r => isSpeedCase(r.case));

  if (!speedResults.length) {
    document.getElementById('speed-run-id').textContent = `${run.id} \u2014 No speed cases in this run`;
    document.getElementById('speed-stats').replaceChildren();
    document.getElementById('speed-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No speed cases found in this run')])
    );
    document.getElementById('speed-results').replaceChildren();
    return;
  }

  document.getElementById('speed-run-id').textContent =
    `${run.id} \u2014 ${run.meta.profileLabel} \u2014 ${formatDate(run.timestamp)}`;

  function getSearchTime(result) {
    if (typeof result.searchTimeMs === 'number' && result.searchTimeMs > 0) return result.searchTimeMs;
    if (typeof result.latencyMs === 'number' && result.latencyMs > 0) return result.latencyMs;
    return null;
  }

  const searchTimes = speedResults.map(r => getSearchTime(r)).filter(t => t !== null);
  const avgSearch = searchTimes.length ? Math.round(searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length) : null;
  const fastest = searchTimes.length ? Math.min(...searchTimes) : null;
  const slowest = searchTimes.length ? Math.max(...searchTimes) : null;

  document.getElementById('speed-stats').replaceChildren(
    buildStatCard('Avg Search Time', avgSearch !== null ? `${avgSearch}ms` : '\u2014', avgSearch !== null ? 'partial' : 'neutral', searchTimes.length ? `${searchTimes.length} vault_search calls` : 'no search data'),
    buildStatCard('Fastest', fastest !== null ? `${fastest}ms` : '\u2014', fastest !== null ? 'pass' : 'neutral', ''),
    buildStatCard('Slowest', slowest !== null ? `${slowest}ms` : '\u2014', slowest !== null ? 'fail' : 'neutral', ''),
  );

  // Bar chart
  const chartEl = document.getElementById('speed-chart');
  chartEl.replaceChildren();
  chartEl.appendChild(createEl('h3', { style: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: 'var(--slate-700)' } }, 'vault_search Execution Time'));

  const hasSearchData = speedResults.some(r => getSearchTime(r) !== null);
  if (!hasSearchData) {
    chartEl.appendChild(createEl('div', { className: 'empty-state', style: { padding: '24px' } }, [
      createEl('p', {}, 'No vault_search timing data. Re-run evals to capture MCP tool timestamps.'),
    ]));
  } else {
    const maxTime = Math.max(...searchTimes, 1);
    const bars = createEl('div', { className: 'speed-bars' });
    speedResults.forEach(r => {
      const searchTime = getSearchTime(r);
      if (searchTime === null) return;
      const pctWidth = (searchTime / maxTime) * 100;
      const speedClass = searchTime < 10 ? 'fast' : searchTime < 50 ? 'medium' : 'slow';

      const row = createEl('div', { className: 'speed-bar-row' });
      row.appendChild(createEl('div', { className: 'speed-bar-label', textContent: r.case }));
      const track = createEl('div', { className: 'speed-bar-track' });
      const fill = createEl('div', { className: `speed-bar-fill ${speedClass}` });
      fill.style.width = `${pctWidth}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(createEl('div', { className: 'speed-bar-value' }, `${searchTime}ms`));
      bars.appendChild(row);
    });
    chartEl.appendChild(bars);
  }

  // Speed cases list
  const speedList = document.getElementById('speed-results');
  const children = [];
  speedResults.forEach(r => {
    const caseDef = state.caseMap[r.case];
    const diff = caseDef ? caseDef.difficulty : '?';
    const status = statusOf(r.passRate);
    const searchTime = getSearchTime(r);

    const row = createEl('div', { className: 'result-row', 'data-case': r.case });
    row.appendChild(createEl('div', { className: `result-icon ${status}` }, statusIcon(r.passRate)));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'result-name' }, r.case));
    row.appendChild(info);
    row.appendChild(difficultyPill(diff));
    row.appendChild(createEl('div', { className: `result-score ${status}` }, `${r.passed}/${r.total}`));
    row.appendChild(createEl('div', { className: 'result-latency' }, searchTime !== null ? `${searchTime}ms` : '\u2014'));
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => toggleAccordion(speedList, r.case, r, row));
    children.push(row);
  });
  speedList.replaceChildren(...children);
}

// === COMPARE TAB ===

function renderCompareSelectors() {
  const selectA = document.getElementById('compare-a');
  const selectB = document.getElementById('compare-b');
  selectA.replaceChildren();
  selectB.replaceChildren();

  // Include all history runs + baselines
  const allOptions = [];
  state.history.forEach(r => {
    allOptions.push({ id: r.id, label: `${r.meta.profileLabel} \u00B7 ${r.kind} \u00B7 ${pct(r.passRate)} \u00B7 ${shortDate(r.timestamp)}` });
  });

  // Add baselines from index
  Object.entries(state.baselinesIndex || {}).forEach(([profileKey, entry]) => {
    Object.entries(entry || {}).forEach(([kind, candidate]) => {
      if (candidate?.id && !allOptions.some(o => o.id === candidate.id)) {
        const label = candidate.profileLabel || profileKey;
        allOptions.push({ id: candidate.id, label: `[baseline] ${label} \u00B7 ${kind}` });
      }
    });
  });

  allOptions.forEach(opt => {
    selectA.appendChild(createEl('option', { value: opt.id }, opt.label));
    selectB.appendChild(createEl('option', { value: opt.id }, opt.label));
  });

  // Default: first two runs if available
  if (allOptions.length >= 2) {
    selectA.selectedIndex = 0;
    selectB.selectedIndex = 1;
  }
}

async function doCompare() {
  const aId = document.getElementById('compare-a').value;
  const bId = document.getElementById('compare-b').value;
  const runA = await getRunById(aId);
  const runB = await getRunById(bId);
  if (!runA || !runB) return;

  const container = document.getElementById('compare-results');

  // Build accuracy comparison
  const bMap = {};
  runB.results.forEach(r => { bMap[r.case] = r; });
  const allCases = [...new Set([...runA.results.map(r => r.case), ...runB.results.map(r => r.case)])];

  const rows = allCases.map(c => {
    const a = runA.results.find(r => r.case === c);
    const b = bMap[c];
    const caseDef = state.caseMap[c];
    const rateA = a ? a.passRate : null;
    const rateB = b ? b.passRate : null;
    const delta = (rateA !== null && rateB !== null) ? rateA - rateB : null;
    const searchA = a && typeof a.searchTimeMs === 'number' ? a.searchTimeMs : null;
    const searchB = b && typeof b.searchTimeMs === 'number' ? b.searchTimeMs : null;
    const searchDelta = (searchA !== null && searchB !== null) ? searchA - searchB : null;
    return { case: c, caseDef, rateA, rateB, delta, searchA, searchB, searchDelta, isSpeed: isSpeedCase(c) };
  }).sort((x, y) => {
    if (x.delta !== null && y.delta !== null) return x.delta - y.delta;
    return 0;
  });

  // Accuracy table
  const accTitle = createEl('div', { className: 'section-title', style: { marginTop: '16px' } }, 'Accuracy Comparison');
  const table = createEl('table', { className: 'compare-table' });
  const thead = createEl('thead');
  const headerRow = createEl('tr');
  ['Case', 'Difficulty', 'Run A', 'Run B', 'Delta'].forEach(h => headerRow.appendChild(createEl('th', {}, h)));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = createEl('tbody');
  rows.forEach(r => {
    const tr = createEl('tr');
    tr.appendChild(createEl('td', {}, createEl('strong', {}, r.case)));
    const tdDiff = createEl('td');
    tdDiff.appendChild(r.caseDef ? difficultyPill(r.caseDef.difficulty) : document.createTextNode('\u2014'));
    tr.appendChild(tdDiff);
    tr.appendChild(createEl('td', { className: r.rateA !== null ? statusOf(r.rateA) : '' }, r.rateA !== null ? pct(r.rateA) : '\u2014'));
    tr.appendChild(createEl('td', { className: r.rateB !== null ? statusOf(r.rateB) : '' }, r.rateB !== null ? pct(r.rateB) : '\u2014'));
    const tdDelta = createEl('td');
    if (r.delta !== null) {
      if (r.delta > 0) tdDelta.appendChild(createEl('span', { className: 'delta-up' }, `+${pct(r.delta)}`));
      else if (r.delta < 0) tdDelta.appendChild(createEl('span', { className: 'delta-down' }, pct(r.delta)));
      else tdDelta.appendChild(createEl('span', { className: 'delta-same' }, '='));
    } else {
      tdDelta.textContent = '\u2014';
    }
    tr.appendChild(tdDelta);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  // Speed comparison table (only speed cases with searchTimeMs)
  const speedRows = rows.filter(r => r.isSpeed && (r.searchA !== null || r.searchB !== null));
  const elements = [accTitle, table];

  if (speedRows.length) {
    const speedTitle = createEl('div', { className: 'section-title', style: { marginTop: '24px' } }, 'Speed Comparison (searchTimeMs)');
    const speedTable = createEl('table', { className: 'compare-table' });
    const speedThead = createEl('thead');
    const speedHeaderRow = createEl('tr');
    ['Case', 'Run A (ms)', 'Run B (ms)', 'Delta (ms)'].forEach(h => speedHeaderRow.appendChild(createEl('th', {}, h)));
    speedThead.appendChild(speedHeaderRow);
    speedTable.appendChild(speedThead);

    const speedTbody = createEl('tbody');
    speedRows.forEach(r => {
      const tr = createEl('tr');
      tr.appendChild(createEl('td', {}, createEl('strong', {}, r.case)));
      tr.appendChild(createEl('td', {}, r.searchA !== null ? String(r.searchA) : '\u2014'));
      tr.appendChild(createEl('td', {}, r.searchB !== null ? String(r.searchB) : '\u2014'));
      const tdDelta = createEl('td');
      if (r.searchDelta !== null) {
        // For speed: negative delta = faster A (good), positive = slower A (bad)
        if (r.searchDelta < 0) tdDelta.appendChild(createEl('span', { className: 'delta-up' }, `${r.searchDelta}ms`));
        else if (r.searchDelta > 0) tdDelta.appendChild(createEl('span', { className: 'delta-down' }, `+${r.searchDelta}ms`));
        else tdDelta.appendChild(createEl('span', { className: 'delta-same' }, '='));
      } else {
        tdDelta.textContent = '\u2014';
      }
      tr.appendChild(tdDelta);
      speedTbody.appendChild(tr);
    });
    speedTable.appendChild(speedTbody);
    elements.push(speedTitle, speedTable);
  }

  container.replaceChildren(...elements);
}

// === HISTORY TAB ===

function renderHistory() {
  const runs = state.history;
  if (!runs.length) {
    document.getElementById('history-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No history yet')])
    );
    document.getElementById('history-list').replaceChildren();
    return;
  }

  const chartContainer = document.getElementById('history-chart');
  chartContainer.replaceChildren();
  chartContainer.appendChild(createEl('h3', { style: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--slate-700)' } }, 'Pass Rate Over Time'));

  const barsEl = createEl('div', { className: 'chart-bars' });
  const runDetailContainer = createEl('div', { id: 'history-run-detail-container' });

  // Color by profile
  const profileColors = {};
  const palette = ['var(--green)', 'var(--amber)', '#6366f1', '#ec4899', '#14b8a6', 'var(--red)'];
  let colorIdx = 0;
  runs.forEach(r => {
    if (!profileColors[r.meta.profileKey]) {
      profileColors[r.meta.profileKey] = palette[colorIdx % palette.length];
      colorIdx++;
    }
  });

  runs.slice().reverse().forEach(r => {
    const h = Math.max(4, r.passRate * 120);
    const color = profileColors[r.meta.profileKey] || barColor(r.passRate);
    const wrapper = createEl('div', { className: 'chart-bar-wrapper', 'data-run-id': r.id });
    wrapper.appendChild(createEl('div', { className: 'chart-value' }, pct(r.passRate)));
    const bar = createEl('div', { className: 'chart-bar' });
    bar.style.height = `${h}px`;
    bar.style.background = color;
    bar.title = `${r.meta.profileLabel}: ${pct(r.passRate)} (${r.id})`;
    wrapper.appendChild(bar);
    wrapper.appendChild(createEl('div', { className: 'chart-label' }, shortDate(r.timestamp)));
    wrapper.addEventListener('click', async () => {
      const runData = await getRunById(r.id);
      showHistoryRunDetail(runData, runDetailContainer);
    });
    barsEl.appendChild(wrapper);
  });
  chartContainer.appendChild(barsEl);

  // Legend
  if (Object.keys(profileColors).length > 1) {
    const legend = createEl('div', { style: { display: 'flex', gap: '16px', marginTop: '12px', flexWrap: 'wrap' } });
    Object.entries(profileColors).forEach(([key, color]) => {
      const label = state.profiles.find(p => p.key === key)?.label || key;
      const item = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--slate-500)' } });
      item.appendChild(createEl('div', { style: { width: '10px', height: '10px', borderRadius: '2px', background: color } }));
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    });
    chartContainer.appendChild(legend);
  }

  chartContainer.after(runDetailContainer);

  const listEl = document.getElementById('history-list');
  listEl.replaceChildren(...runs.map(r => {
    const row = createEl('div', { className: 'history-row', 'data-run-id': r.id });
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'run-label' }, r.id));
    const metaRow = createEl('div', { className: 'run-date' });
    metaRow.appendChild(document.createTextNode(formatDate(r.timestamp)));
    metaRow.appendChild(document.createTextNode(' \u00B7 '));
    metaRow.appendChild(metaBadge(r.meta.profileLabel));
    metaRow.appendChild(document.createTextNode(' '));
    metaRow.appendChild(metaBadge(r.kind));
    info.appendChild(metaRow);
    row.appendChild(info);
    row.appendChild(createEl('div', { style: { fontSize: '12px', color: 'var(--slate-500)' } }, `${r.caseCount} cases`));
    row.appendChild(createEl('div', { className: `result-score ${statusOf(r.passRate)}` }, `${r.totalPassed}/${r.totalAssertions}`));
    row.appendChild(statusPill(statusOf(r.passRate)));
    row.addEventListener('click', async () => {
      const runData = await getRunById(r.id);
      const container = document.getElementById('history-run-detail-container');
      showHistoryRunDetail(runData, container);
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return row;
  }));
}

function showHistoryRunDetail(runData, container) {
  if (state.expandedRun === runData.id) {
    container.replaceChildren();
    state.expandedRun = null;
    return;
  }

  state.expandedRun = runData.id;
  const totalPassed = runData.results.reduce((s, r) => s + r.passed, 0);
  const totalAssertions = runData.results.reduce((s, r) => s + r.total, 0);
  const rate = totalAssertions ? totalPassed / totalAssertions : 0;

  const detail = createEl('div', { className: 'history-run-detail' });
  const header = createEl('div', { className: 'detail-header' });
  const titleRow = createEl('div');
  titleRow.appendChild(createEl('div', { className: 'detail-title', textContent: runData.id }));
  const sub = createEl('div', { style: { fontSize: '12px', color: 'var(--slate-400)', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  sub.appendChild(document.createTextNode(formatDate(runData.timestamp)));
  sub.appendChild(metaBadge(runData.meta.profileLabel));
  sub.appendChild(metaBadge(runData.kind));
  titleRow.appendChild(sub);
  header.appendChild(titleRow);

  const headerRight = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
  headerRight.appendChild(createEl('div', { className: `stat-value ${statusOf(rate)}`, style: { fontSize: '24px' } }, pct(rate)));
  const closeBtn = createEl('button', { className: 'close-btn' }, 'Close');
  closeBtn.addEventListener('click', () => {
    container.replaceChildren();
    state.expandedRun = null;
  });
  headerRight.appendChild(closeBtn);
  header.appendChild(headerRight);
  detail.appendChild(header);

  const resultsList = createEl('div', { className: 'results-list' });
  runData.results.forEach(r => {
    const caseDef = state.caseMap[r.case];
    const diff = caseDef ? caseDef.difficulty : '?';
    const status = statusOf(r.passRate);
    const row = createEl('div', { className: 'result-row', 'data-case': r.case });
    row.appendChild(createEl('div', { className: `result-icon ${status}` }, statusIcon(r.passRate)));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'result-name' }, r.case));
    row.appendChild(info);
    row.appendChild(difficultyPill(diff));
    row.appendChild(createEl('div', { className: `result-score ${status}` }, `${r.passed}/${r.total}`));
    row.appendChild(createEl('div', { className: 'result-latency' }, typeof r.latencyMs === 'number' ? `${(r.latencyMs / 1000).toFixed(1)}s` : ''));
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => toggleAccordion(resultsList, r.case, r, row));
    resultsList.appendChild(row);
  });
  detail.appendChild(resultsList);
  container.replaceChildren(detail);
}

init().catch(err => {
  console.error('Dashboard init failed:', err);
  document.querySelector('.main').replaceChildren(
    createEl('div', { className: 'empty-state' }, [
      createEl('h2', {}, 'Failed to load'),
      createEl('p', {}, err.message),
    ])
  );
});
