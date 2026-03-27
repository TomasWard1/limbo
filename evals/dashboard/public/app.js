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
  selectedOverviewRunId: null,
  selectedOverviewBaselineId: '',
  selectedSpeedRunId: null,
  selectedSpeedBaselineId: '',
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

function normalizeMeta(meta = {}) {
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
function statusIcon(passRate) { return passRate >= 1 ? '✓' : passRate > 0 ? '◐' : '✗'; }

function formatDate(ts) {
  if (!ts) return '—';
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
  resetSelectionsForProfile();
}

function resetSelectionsForProfile() {
  state.selectedOverviewRunId = pickDefaultRunId(state.selectedProfile, 'accuracy');
  state.selectedOverviewBaselineId = pickDefaultBaselineId(state.selectedProfile, 'accuracy');
  state.selectedSpeedRunId = pickDefaultRunId(state.selectedProfile, 'speed');
  state.selectedSpeedBaselineId = pickDefaultBaselineId(state.selectedProfile, 'speed');
}

function getRunsForProfile(profileKey, mode) {
  const runs = state.history.filter(r => r.meta.profileKey === profileKey);
  const sorted = runs.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (mode === 'speed') {
    return sorted.filter(r => r.kind === 'speed');
  }
  if (mode === 'accuracy') {
    const full = sorted.filter(r => r.kind === 'full');
    return full.length ? full : sorted.filter(r => r.kind !== 'speed');
  }
  return sorted;
}

function pickDefaultRunId(profileKey, mode) {
  const runs = getRunsForProfile(profileKey, mode);
  if (runs.length) return runs[0].id;
  return '';
}

function pickDefaultBaselineId(profileKey, mode) {
  const entry = state.baselinesIndex?.[profileKey];
  if (!entry) return '';
  const kind = mode === 'speed' ? 'speed' : 'full';
  return entry[kind]?.id || entry.any?.id || '';
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
  return `${shortDate(run.timestamp)} · ${kindLabel} · ${pct(rate)} · ${run.id}`;
}

function renderNavMeta() {
  const navMeta = document.getElementById('nav-meta');
  navMeta.replaceChildren(
    metaBadge(getSelectedProfileLabel())
  );
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
    resetSelectionsForProfile();
    renderNavMeta();
    renderAll();
  });

  document.getElementById('overview-run-select').addEventListener('change', e => {
    state.selectedOverviewRunId = e.target.value;
    renderOverview();
    renderCompareSelectors();
  });
  document.getElementById('overview-baseline-select').addEventListener('change', e => {
    state.selectedOverviewBaselineId = e.target.value;
    renderOverview();
    renderCompareSelectors();
  });
  document.getElementById('speed-run-select').addEventListener('change', e => {
    state.selectedSpeedRunId = e.target.value;
    renderSpeed();
  });
  document.getElementById('speed-baseline-select').addEventListener('change', e => {
    state.selectedSpeedBaselineId = e.target.value;
    renderSpeed();
  });
  document.getElementById('compare-btn').addEventListener('click', doCompare);
}

function renderAll() {
  populateSelectors();
  renderOverview();
  renderSpeed();
  renderHistory();
  renderCompareSelectors();
  setupFilters();
}

function populateSelectors() {
  const accuracyRuns = getRunsForProfile(state.selectedProfile, 'accuracy');
  const speedRuns = getRunsForProfile(state.selectedProfile, 'speed');

  populateRunSelect(document.getElementById('overview-run-select'), accuracyRuns, state.selectedOverviewRunId, 'No accuracy runs');
  populateRunSelect(document.getElementById('speed-run-select'), speedRuns, state.selectedSpeedRunId, 'No speed runs');
  populateBaselineSelect(document.getElementById('overview-baseline-select'), accuracyRuns, state.selectedOverviewBaselineId, 'No baseline');
  populateBaselineSelect(document.getElementById('speed-baseline-select'), speedRuns, state.selectedSpeedBaselineId, 'No baseline');

  if (accuracyRuns.length && !accuracyRuns.some(r => r.id === state.selectedOverviewRunId)) {
    state.selectedOverviewRunId = accuracyRuns[0].id;
  }
  if (speedRuns.length && !speedRuns.some(r => r.id === state.selectedSpeedRunId)) {
    state.selectedSpeedRunId = speedRuns[0].id;
  }
}

function populateRunSelect(el, runs, selectedId, emptyLabel) {
  if (!runs.length) {
    el.replaceChildren(createEl('option', { value: '' }, emptyLabel));
    el.value = '';
    return;
  }
  el.replaceChildren(...runs.map(r => createEl('option', { value: r.id }, formatRunOption(r))));
  el.value = runs.some(r => r.id === selectedId) ? selectedId : runs[0].id;
}

function populateBaselineSelect(el, runs, selectedId, emptyLabel) {
  const options = [createEl('option', { value: '' }, emptyLabel)];
  runs.forEach(r => options.push(createEl('option', { value: r.id }, formatRunOption(r))));
  el.replaceChildren(...options);
  el.value = selectedId && runs.some(r => r.id === selectedId) ? selectedId : '';
}

function setupFilters() {
  const diffFilter = document.getElementById('filter-difficulty');
  const statusFilter = document.getElementById('filter-status');
  const searchFilter = document.getElementById('filter-search');

  if (diffFilter.dataset.bound) return;
  diffFilter.dataset.bound = '1';

  const applyFilters = async () => {
    const run = await getRunById(state.selectedOverviewRunId);
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

async function renderOverview() {
  const run = await getRunById(state.selectedOverviewRunId);
  const baseline = await getRunById(state.selectedOverviewBaselineId);
  if (!run) {
    document.getElementById('overview-run-id').textContent = 'No accuracy run selected';
    document.getElementById('overview-stats').replaceChildren();
    document.getElementById('overview-difficulty').replaceChildren();
    document.getElementById('overview-results').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No accuracy runs for this profile')])
    );
    return;
  }

  const baselineText = baseline ? ` vs baseline ${baseline.id}` : '';
  document.getElementById('overview-run-id').textContent =
    `${run.id} — ${run.meta.profileLabel} — ${formatDate(run.timestamp)}${baselineText}`;

  const totalPassed = run.results.reduce((s, r) => s + r.passed, 0);
  const totalAssertions = run.results.reduce((s, r) => s + r.total, 0);
  const overallRate = totalAssertions ? totalPassed / totalAssertions : 0;
  const casesFullPass = run.results.filter(r => r.passRate >= 1).length;
  const casesFailed = run.results.filter(r => r.passRate < 1).length;
  const baselineRate = baseline ? (baseline.results.reduce((s, r) => s + r.passed, 0) / baseline.results.reduce((s, r) => s + r.total, 0)) : null;
  const delta = baselineRate !== null ? overallRate - baselineRate : null;

  const speedSearchTimes = run.results
    .filter(r => isSpeedCase(r.case) && typeof r.searchTimeMs === 'number' && r.searchTimeMs > 0)
    .map(r => r.searchTimeMs);
  const avgSpeedLatency = speedSearchTimes.length
    ? Math.round(speedSearchTimes.reduce((a, b) => a + b, 0) / speedSearchTimes.length)
    : null;

  document.getElementById('overview-stats').replaceChildren(
    buildStatCard('Pass Rate', pct(overallRate), statusOf(overallRate), delta !== null ? `baseline ${pct(baselineRate)} (${delta > 0 ? '+' : ''}${pct(delta)})` : `${totalPassed}/${totalAssertions} assertions`),
    buildStatCard('Cases', String(run.results.length), 'neutral', `${casesFullPass} passed, ${casesFailed} partial/fail`),
    buildStatCard('Avg Search Time', avgSpeedLatency ? `${avgSpeedLatency}ms` : '—', avgSpeedLatency !== null ? 'partial' : 'neutral', speedSearchTimes.length ? `${speedSearchTimes.length} vault_search calls in this run` : 'no search data'),
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
  document.getElementById('overview-difficulty').replaceChildren(
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
  const container = document.getElementById('overview-results');
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
    row.appendChild(createEl('div', { className: `assertion-icon ${sr.pass ? 'pass' : 'fail'}` }, sr.pass ? '✓' : '✗'));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'assertion-type' }, sr.assertion.type + (sr.assertion.tool ? ` → ${sr.assertion.tool}` : '')));
    info.appendChild(createEl('div', { className: 'assertion-reason' }, sr.reason));
    row.appendChild(info);
    assertSection.appendChild(row);
  });
  el.appendChild(assertSection);

  const respSection = createEl('div', { className: 'detail-section' });
  respSection.appendChild(createEl('h3', {}, 'LLM Response'));
  respSection.appendChild(createEl('div', { className: 'response-box', textContent: result.response || '(no response captured)' }));
  el.appendChild(respSection);

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

async function renderSpeed() {
  const run = await getRunById(state.selectedSpeedRunId);
  const baseline = await getRunById(state.selectedSpeedBaselineId);

  if (!run) {
    document.getElementById('speed-run-id').textContent = 'No speed runs for this profile';
    document.getElementById('speed-stats').replaceChildren();
    document.getElementById('speed-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No speed runs for this profile')])
    );
    document.getElementById('speed-results').replaceChildren();
    return;
  }

  document.getElementById('speed-run-id').textContent =
    `${run.id} — ${run.meta.profileLabel} — ${formatDate(run.timestamp)}${baseline ? ` vs baseline ${baseline.id}` : ''}`;

  const speedResults = run.results.filter(r => isSpeedCase(r.case));
  if (!speedResults.length) {
    document.getElementById('speed-stats').replaceChildren();
    document.getElementById('speed-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No speed cases found in this run')])
    );
    document.getElementById('speed-results').replaceChildren();
    return;
  }

  function getSearchTime(result) {
    if (typeof result.searchTimeMs === 'number' && result.searchTimeMs > 0) return result.searchTimeMs;
    return null;
  }

  const searchTimes = speedResults.map(r => getSearchTime(r)).filter(t => t !== null);
  const latencies = speedResults.filter(r => typeof r.latencyMs === 'number' && r.latencyMs > 0).map(r => r.latencyMs);
  const avgSearch = searchTimes.length ? Math.round(searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length) : null;
  const avgTotal = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  document.getElementById('speed-stats').replaceChildren(
    buildStatCard('Avg Search Time', avgSearch !== null ? `${avgSearch}ms` : '—', avgSearch !== null ? 'partial' : 'neutral', searchTimes.length ? `${searchTimes.length} vault_search calls` : 'no search data yet'),
    buildStatCard('Speed Cases', String(speedResults.length), 'neutral', ''),
    buildStatCard('Avg Total Turn', avgTotal ? `${(avgTotal / 1000).toFixed(1)}s` : '—', 'neutral', 'includes LLM thinking'),
  );

  const chartEl = document.getElementById('speed-chart');
  chartEl.replaceChildren();
  chartEl.appendChild(createEl('h3', { style: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: 'var(--slate-700)' } }, 'vault_search Execution Time'));

  const hasSearchData = speedResults.some(r => getSearchTime(r) !== null);
  if (!hasSearchData) {
    chartEl.appendChild(createEl('div', { className: 'empty-state', style: { padding: '24px' } }, [
      createEl('p', {}, 'No vault_search timing data. Re-run evals to capture MCP tool timestamps.'),
    ]));
  } else {
    const baselineSearchMap = {};
    if (baseline) {
      baseline.results.forEach(r => {
        if (isSpeedCase(r.case) && typeof r.searchTimeMs === 'number') baselineSearchMap[r.case] = r.searchTimeMs;
      });
    }

    if (Object.keys(baselineSearchMap).length > 0) {
      const legend = createEl('div', { style: { display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px', color: 'var(--slate-400)' } });
      legend.appendChild(createEl('span', {}, 'Selected run (bar)'));
      legend.appendChild(createEl('span', {}, 'Selected baseline (marker)'));
      chartEl.appendChild(legend);
    }

    const maxTime = Math.max(...searchTimes, ...Object.values(baselineSearchMap), 1);
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

      if (baselineSearchMap[r.case] !== undefined) {
        const marker = createEl('div', { className: 'speed-bar-baseline' });
        marker.style.left = `${(baselineSearchMap[r.case] / maxTime) * 100}%`;
        marker.title = `Baseline: ${baselineSearchMap[r.case]}ms`;
        track.appendChild(marker);
      }

      row.appendChild(track);
      row.appendChild(createEl('div', { className: 'speed-bar-value' }, `${searchTime}ms`));
      bars.appendChild(row);
    });
    chartEl.appendChild(bars);
  }

  const speedList = document.getElementById('speed-results');
  const children = [];
  speedResults.forEach(r => {
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
    row.appendChild(createEl('div', { className: 'result-latency' }, getSearchTime(r) !== null ? `${getSearchTime(r)}ms` : '—'));
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => toggleAccordion(speedList, r.case, r, row));
    children.push(row);
  });
  speedList.replaceChildren(...children);
}

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

  runs.slice().reverse().forEach(r => {
    const h = Math.max(4, r.passRate * 120);
    const wrapper = createEl('div', { className: 'chart-bar-wrapper', 'data-run-id': r.id });
    wrapper.appendChild(createEl('div', { className: 'chart-value' }, pct(r.passRate)));
    const bar = createEl('div', { className: 'chart-bar' });
    bar.style.height = `${h}px`;
    bar.style.background = barColor(r.passRate);
    bar.title = `${r.id}: ${pct(r.passRate)}`;
    wrapper.appendChild(bar);
    wrapper.appendChild(createEl('div', { className: 'chart-label' }, shortDate(r.timestamp)));
    wrapper.addEventListener('click', async () => {
      const runData = await getRunById(r.id);
      showHistoryRunDetail(runData, runDetailContainer);
    });
    barsEl.appendChild(wrapper);
  });
  chartContainer.appendChild(barsEl);
  chartContainer.after(runDetailContainer);

  const listEl = document.getElementById('history-list');
  listEl.replaceChildren(...runs.map(r => {
    const row = createEl('div', { className: 'history-row', 'data-run-id': r.id });
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'run-label' }, r.id));
    const metaRow = createEl('div', { className: 'run-date' });
    metaRow.appendChild(document.createTextNode(formatDate(r.timestamp)));
    metaRow.appendChild(document.createTextNode(' · '));
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

function renderCompareSelectors() {
  const selectA = document.getElementById('compare-a');
  const selectB = document.getElementById('compare-b');
  selectA.replaceChildren();
  selectB.replaceChildren();

  state.history.forEach(r => {
    const text = `${r.meta.profileLabel} · ${r.kind} · ${pct(r.passRate)} · ${shortDate(r.timestamp)}`;
    selectA.appendChild(createEl('option', { value: r.id }, text));
    selectB.appendChild(createEl('option', { value: r.id }, text));
  });

  if (state.selectedOverviewRunId) selectA.value = state.selectedOverviewRunId;
  if (state.selectedOverviewBaselineId) selectB.value = state.selectedOverviewBaselineId;
  else if (state.history.length > 1) selectB.selectedIndex = 1;
}

async function doCompare() {
  const aId = document.getElementById('compare-a').value;
  const bId = document.getElementById('compare-b').value;
  const runA = await getRunById(aId);
  const runB = await getRunById(bId);
  if (!runA || !runB) return;

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
    return { case: c, caseDef, rateA, rateB, delta };
  }).sort((x, y) => {
    if (x.delta !== null && y.delta !== null) return x.delta - y.delta;
    return 0;
  });

  const container = document.getElementById('compare-results');
  const header = createEl('div', { className: 'compare-meta' }, [
    metaBadge(`A: ${runA.meta.profileLabel} · ${runA.kind} · ${runA.id}`),
    metaBadge(`B: ${runB.meta.profileLabel} · ${runB.kind} · ${runB.id}`),
  ]);
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
    tdDiff.appendChild(r.caseDef ? difficultyPill(r.caseDef.difficulty) : document.createTextNode('—'));
    tr.appendChild(tdDiff);
    tr.appendChild(createEl('td', { className: r.rateA !== null ? statusOf(r.rateA) : '' }, r.rateA !== null ? pct(r.rateA) : '—'));
    tr.appendChild(createEl('td', { className: r.rateB !== null ? statusOf(r.rateB) : '' }, r.rateB !== null ? pct(r.rateB) : '—'));
    const tdDelta = createEl('td');
    if (r.delta !== null) {
      if (r.delta > 0) tdDelta.appendChild(createEl('span', { className: 'delta-up' }, `+${pct(r.delta)}`));
      else if (r.delta < 0) tdDelta.appendChild(createEl('span', { className: 'delta-down' }, pct(r.delta)));
      else tdDelta.appendChild(createEl('span', { className: 'delta-same' }, '='));
    } else {
      tdDelta.textContent = '—';
    }
    tr.appendChild(tdDelta);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.replaceChildren(header, table);
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
