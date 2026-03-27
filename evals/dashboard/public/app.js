// === Limbo Eval Dashboard ===
// Note: All data comes from local eval JSON files served by our own Node server.
// All dynamic text is escaped via escapeHtml() before insertion.

const state = {
  latest: null,
  baseline: null,
  cases: [],
  history: [],
  currentView: 'overview',
};

// === API ===
async function api(path) {
  const res = await fetch(`/api/${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

// === Init ===
async function init() {
  const [latest, baseline, cases, history] = await Promise.all([
    api('latest'),
    api('baseline'),
    api('cases'),
    api('history'),
  ]);

  state.latest = latest;
  state.baseline = baseline;
  state.cases = cases;
  state.history = history;

  // Build case lookup
  state.caseMap = {};
  cases.forEach(c => { state.caseMap[c.name] = c; });

  setupNav();
  renderOverview();
  renderHistory();
  renderCompareSelectors();
  renderRubrics();
  setupFilters();
}

// === Navigation ===
function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;
      document.getElementById(`view-${view}`).classList.add('active');
      state.currentView = view;
    });
  });
}

function showView(viewId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  const tab = document.querySelector(`[data-view="${viewId}"]`);
  if (tab) tab.classList.add('active');
  state.currentView = viewId;
}

// === Helpers ===
function pct(n) { return `${Math.round(n * 100)}%`; }
function statusOf(passRate) { return passRate >= 1 ? 'pass' : passRate > 0 ? 'partial' : 'fail'; }
function statusIcon(passRate) { return passRate >= 1 ? '\u2713' : passRate > 0 ? '\u25D0' : '\u2717'; }

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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
  if (rate >= 0.7) return 'var(--yellow)';
  return 'var(--red)';
}

// === Safe DOM builders ===

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
  el.className = `pill pill-${escapeHtml(d)}`;
  el.textContent = d;
  return el;
}

function statusPill(s) {
  const el = document.createElement('span');
  el.className = `pill pill-${escapeHtml(s)}`;
  el.textContent = s;
  return el;
}

function tagPill(t) {
  const el = document.createElement('span');
  el.className = 'pill';
  el.style.cssText = 'background: var(--cream); border: 1px solid var(--border-light); color: var(--text-gray)';
  el.textContent = t;
  return el;
}

// === Overview ===
function renderOverview() {
  const run = state.latest;
  if (!run) {
    const empty = document.getElementById('view-overview');
    empty.replaceChildren(
      createEl('div', { className: 'empty-state' }, [
        createEl('h2', {}, 'No results yet'),
        createEl('p', {}, 'Run node evals/cli.js run to generate results.'),
      ])
    );
    return;
  }

  document.getElementById('overview-run-id').textContent =
    `${run.id} \u2014 ${formatDate(run.timestamp)}`;

  // Stats
  const totalPassed = run.results.reduce((s, r) => s + r.passed, 0);
  const totalAssertions = run.results.reduce((s, r) => s + r.total, 0);
  const overallRate = totalAssertions ? totalPassed / totalAssertions : 0;
  const casesFullPass = run.results.filter(r => r.passRate >= 1).length;
  const casesFailed = run.results.filter(r => r.passRate < 1).length;

  // Latency stats
  const latencies = run.results.filter(r => typeof r.latencyMs === 'number' && r.latencyMs > 0).map(r => r.latencyMs);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const maxLatency = latencies.length ? Math.max(...latencies) : null;

  const statsEl = document.getElementById('overview-stats');
  statsEl.replaceChildren(
    buildStatCard('Pass Rate', pct(overallRate), statusOf(overallRate), `${totalPassed}/${totalAssertions} assertions`),
    buildStatCard('Cases', String(run.results.length), 'neutral', `${casesFullPass} passed, ${casesFailed} with failures`),
    buildStatCard('Full Pass', String(casesFullPass), 'pass', `${pct(casesFullPass / run.results.length)} of cases`),
    buildStatCard('Avg Latency', avgLatency ? `${(avgLatency / 1000).toFixed(1)}s` : '\u2014', avgLatency && avgLatency < 15000 ? 'pass' : avgLatency ? 'partial' : 'neutral', maxLatency ? `max ${(maxLatency / 1000).toFixed(1)}s` : 'no latency data'),
  );

  // Difficulty breakdown
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
  const diffEl = document.getElementById('overview-difficulty');
  diffEl.replaceChildren(...diffOrder.filter(d => byDiff[d]).map(d => {
    const b = byDiff[d];
    const rate = b.total ? b.passed / b.total : 0;
    const card = createEl('div', { className: 'difficulty-card' });
    const header = createEl('div', { className: 'difficulty-header' });
    const label = createEl('span', { className: 'difficulty-label' });
    label.appendChild(difficultyPill(d));
    label.appendChild(document.createTextNode(` ${b.cases} cases`));
    header.appendChild(label);
    const rateEl = createEl('span', { className: `difficulty-rate ${statusOf(rate)}`, textContent: pct(rate) });
    header.appendChild(rateEl);
    card.appendChild(header);
    const bar = createEl('div', { className: 'progress-bar' });
    const fill = createEl('div', { className: `progress-fill ${statusOf(rate)}` });
    fill.style.width = `${rate * 100}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
    return card;
  }));

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
  container.replaceChildren(...results.map(r => {
    const caseDef = state.caseMap[r.case];
    const diff = caseDef ? caseDef.difficulty : '?';
    const status = statusOf(r.passRate);

    const row = createEl('div', { className: 'result-row', 'data-case': r.case });
    row.appendChild(createEl('div', { className: `result-icon ${status}` }, statusIcon(r.passRate)));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'result-name' }, r.case));
    info.appendChild(createEl('div', { className: 'result-desc' }, caseDef ? caseDef.description : ''));
    row.appendChild(info);
    row.appendChild(difficultyPill(diff));
    row.appendChild(createEl('div', { className: `result-score ${status}` }, `${r.passed}/${r.total}`));
    if (typeof r.latencyMs === 'number' && r.latencyMs > 0) {
      row.appendChild(createEl('div', { className: 'result-latency', style: { fontSize: '12px', color: 'var(--text-gray)', minWidth: '60px', textAlign: 'right' } }, `${(r.latencyMs / 1000).toFixed(1)}s`));
    }
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => showResultDetail(r.case));
    return row;
  }));
}

// === Filters ===
function setupFilters() {
  const diffFilter = document.getElementById('filter-difficulty');
  const statusFilter = document.getElementById('filter-status');
  const searchFilter = document.getElementById('filter-search');

  const applyFilters = () => {
    if (!state.latest) return;
    let results = [...state.latest.results];

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
      results = results.filter(r => {
        const c = state.caseMap[r.case];
        return r.case.toLowerCase().includes(search) ||
          (c && c.description.toLowerCase().includes(search));
      });
    }

    renderResultsList(results);
  };

  diffFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  searchFilter.addEventListener('input', applyFilters);
}

// === Detail View ===
function showResultDetail(caseName, runData) {
  const run = runData || state.latest;
  const result = run.results.find(r => r.case === caseName);
  if (!result) return;

  const caseDef = state.caseMap[caseName];
  const status = statusOf(result.passRate);
  const container = document.getElementById('result-detail');
  container.replaceChildren();

  // Back button
  const backBtn = createEl('button', { className: 'detail-back' }, '\u2190 Back to overview');
  backBtn.addEventListener('click', () => showView('overview'));
  container.appendChild(backBtn);

  // Header
  const header = createEl('div', { className: 'detail-header' });
  const headerLeft = createEl('div');
  headerLeft.appendChild(createEl('h1', { className: 'detail-title' }, caseName));
  headerLeft.appendChild(createEl('p', { style: { color: 'var(--text-gray)', marginTop: '4px' } }, caseDef ? caseDef.description : ''));
  const meta = createEl('div', { className: 'detail-meta' });
  if (caseDef) meta.appendChild(difficultyPill(caseDef.difficulty));
  meta.appendChild(statusPill(status));
  if (caseDef && caseDef.tags) caseDef.tags.forEach(t => meta.appendChild(tagPill(t)));
  headerLeft.appendChild(meta);
  header.appendChild(headerLeft);
  const bigScore = createEl('div', { className: `stat-value ${status}` }, pct(result.passRate));
  bigScore.style.fontSize = '48px';
  header.appendChild(bigScore);
  container.appendChild(header);

  // Latency
  if (typeof result.latencyMs === 'number' && result.latencyMs > 0) {
    const latencySection = createEl('div', { className: 'detail-section' });
    const latencyGrid = createEl('div', { className: 'stats-grid' });
    latencyGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    latencyGrid.appendChild(buildStatCard('Total Latency', `${(result.latencyMs / 1000).toFixed(1)}s`, result.latencyMs < 15000 ? 'pass' : 'partial', `${result.latencyMs}ms`));
    latencyGrid.appendChild(buildStatCard('MCP Tool Calls', String(result.mcpLogCount || 0), 'neutral', 'captured via eval logging'));
    latencySection.appendChild(latencyGrid);
    container.appendChild(latencySection);
  }

  // Assertions
  const assertSection = createEl('div', { className: 'detail-section' });
  assertSection.appendChild(createEl('h3', {}, `Assertions (${result.passed}/${result.total})`));
  result.scoreResults.forEach(sr => {
    const row = createEl('div', { className: 'assertion-row' });
    row.appendChild(createEl('div', { className: `assertion-icon ${sr.pass ? 'pass' : 'fail'}` }, sr.pass ? '\u2713' : '\u2717'));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'assertion-type' }, sr.assertion.type + (sr.assertion.tool ? ` \u2192 ${sr.assertion.tool}` : '')));
    info.appendChild(createEl('div', { className: 'assertion-reason' }, sr.reason));
    if (sr.assertion.pattern) {
      const pat = createEl('div', { style: { fontSize: '12px', color: 'var(--text-light)', marginTop: '2px', fontFamily: 'monospace' } });
      pat.textContent = `pattern: ${sr.assertion.pattern}`;
      info.appendChild(pat);
    }
    row.appendChild(info);
    assertSection.appendChild(row);
  });
  container.appendChild(assertSection);

  // Test Input
  if (caseDef) {
    const inputSection = createEl('div', { className: 'detail-section' });
    inputSection.appendChild(createEl('h3', {}, 'Test Input'));
    const inputText = caseDef.input || (caseDef.steps ? caseDef.steps.map((s, i) => `Step ${i + 1}: ${s.input}`).join('\n') : '');
    inputSection.appendChild(createEl('div', { className: 'response-box', textContent: inputText }));
    container.appendChild(inputSection);
  }

  // LLM Response
  const respSection = createEl('div', { className: 'detail-section' });
  respSection.appendChild(createEl('h3', {}, 'LLM Response'));
  respSection.appendChild(createEl('div', { className: 'response-box', textContent: result.response || '(no response captured)' }));
  container.appendChild(respSection);

  // Vault Changes
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
  container.appendChild(vaultSection);

  // Judge Results
  if (result.judgeResults) {
    const judgeSection = createEl('div', { className: 'detail-section' });
    judgeSection.appendChild(createEl('h3', {}, 'Judge Evaluation'));
    Object.entries(result.judgeResults).forEach(([key, jr]) => {
      const row = createEl('div', { className: 'assertion-row' });
      row.appendChild(createEl('div', { className: `assertion-icon ${jr.pass ? 'pass' : 'fail'}` }, jr.pass ? '\u2713' : '\u2717'));
      const info = createEl('div');
      info.appendChild(createEl('div', { className: 'assertion-type' }, key));
      info.appendChild(createEl('div', { className: 'assertion-reason' }, jr.reason || ''));
      row.appendChild(info);
      judgeSection.appendChild(row);
    });
    container.appendChild(judgeSection);
  }

  // Case Definition
  if (caseDef) {
    const defSection = createEl('div', { className: 'detail-section' });
    defSection.appendChild(createEl('h3', {}, 'Case Definition'));
    const defBox = createEl('div', { className: 'response-box' });
    defBox.style.fontFamily = "'SF Mono', 'Fira Code', monospace";
    defBox.style.fontSize = '13px';
    defBox.textContent = JSON.stringify(caseDef, null, 2);
    defSection.appendChild(defBox);
    container.appendChild(defSection);
  }

  showView('results');
}

// === History ===
function renderHistory() {
  const runs = state.history;
  if (!runs.length) {
    const el = document.getElementById('view-history');
    el.replaceChildren(createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No history yet')]));
    return;
  }

  // Bar chart
  const chartContainer = document.getElementById('history-chart');
  chartContainer.replaceChildren();
  chartContainer.appendChild(createEl('h3', { style: { marginBottom: '16px' } }, 'Pass Rate Over Time'));
  const barsEl = createEl('div', { className: 'chart-bars' });
  runs.slice().reverse().forEach(r => {
    const h = Math.max(4, r.passRate * 150);
    const wrapper = createEl('div', { className: 'chart-bar-wrapper', 'data-run-id': r.id });
    wrapper.appendChild(createEl('div', { className: 'chart-value' }, pct(r.passRate)));
    const bar = createEl('div', { className: 'chart-bar' });
    bar.style.height = `${h}px`;
    bar.style.background = barColor(r.passRate);
    bar.title = `${r.id}: ${pct(r.passRate)}`;
    wrapper.appendChild(bar);
    wrapper.appendChild(createEl('div', { className: 'chart-label' }, shortDate(r.timestamp)));
    wrapper.addEventListener('click', async () => {
      const runData = await api(`run/${r.id}`);
      showRunDetail(runData);
    });
    barsEl.appendChild(wrapper);
  });
  chartContainer.appendChild(barsEl);

  // List
  const listEl = document.getElementById('history-list');
  listEl.replaceChildren(...runs.map(r => {
    const row = createEl('div', { className: 'history-row', 'data-run-id': r.id });
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'run-label' }, r.id));
    info.appendChild(createEl('div', { className: 'run-date' }, formatDate(r.timestamp)));
    row.appendChild(info);
    row.appendChild(createEl('div', {}, `${r.caseCount} cases`));
    row.appendChild(createEl('div', { className: `result-score ${statusOf(r.passRate)}` }, `${r.totalPassed}/${r.totalAssertions}`));
    row.appendChild(statusPill(statusOf(r.passRate)));
    row.addEventListener('click', async () => {
      const runData = await api(`run/${r.id}`);
      showRunDetail(runData);
    });
    return row;
  }));
}

function showRunDetail(runData) {
  const container = document.getElementById('result-detail');
  container.replaceChildren();

  const totalPassed = runData.results.reduce((s, r) => s + r.passed, 0);
  const totalAssertions = runData.results.reduce((s, r) => s + r.total, 0);
  const rate = totalAssertions ? totalPassed / totalAssertions : 0;

  const backBtn = createEl('button', { className: 'detail-back' }, '\u2190 Back to history');
  backBtn.addEventListener('click', () => showView('history'));
  container.appendChild(backBtn);

  const header = createEl('div', { className: 'detail-header' });
  const headerLeft = createEl('div');
  headerLeft.appendChild(createEl('h1', { className: 'detail-title' }, runData.id));
  headerLeft.appendChild(createEl('p', { style: { color: 'var(--text-gray)', marginTop: '4px' } }, formatDate(runData.timestamp)));
  header.appendChild(headerLeft);
  const bigScore = createEl('div', { className: `stat-value ${statusOf(rate)}` }, pct(rate));
  bigScore.style.fontSize = '48px';
  header.appendChild(bigScore);
  container.appendChild(header);

  const statsGrid = createEl('div', { className: 'stats-grid' });
  statsGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  statsGrid.appendChild(buildStatCard('Cases', String(runData.results.length), 'neutral', ''));
  statsGrid.appendChild(buildStatCard('Assertions', `${totalPassed}/${totalAssertions}`, statusOf(rate), ''));
  statsGrid.appendChild(buildStatCard('Pass Rate', pct(rate), statusOf(rate), ''));
  container.appendChild(statsGrid);

  const resultsList = createEl('div', { className: 'results-list' });
  runData.results.forEach(r => {
    const caseDef = state.caseMap[r.case];
    const diff = caseDef ? caseDef.difficulty : '?';
    const status = statusOf(r.passRate);
    const row = createEl('div', { className: 'result-row' });
    row.appendChild(createEl('div', { className: `result-icon ${status}` }, statusIcon(r.passRate)));
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'result-name' }, r.case));
    info.appendChild(createEl('div', { className: 'result-desc' }, caseDef ? caseDef.description : ''));
    row.appendChild(info);
    row.appendChild(difficultyPill(diff));
    row.appendChild(createEl('div', { className: `result-score ${status}` }, `${r.passed}/${r.total}`));
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => showResultDetail(r.case, runData));
    resultsList.appendChild(row);
  });
  container.appendChild(resultsList);

  showView('results');
}

// === Compare ===
function renderCompareSelectors() {
  const runs = state.history;
  const selectA = document.getElementById('compare-a');
  const selectB = document.getElementById('compare-b');

  // Clear existing
  selectA.replaceChildren();
  selectB.replaceChildren();

  if (state.latest) {
    const totalP = state.latest.results.reduce((s, r) => s + r.passed, 0);
    const totalA = state.latest.results.reduce((s, r) => s + r.total, 0);
    const opt = createEl('option', { value: 'latest' }, `latest (${pct(totalA ? totalP / totalA : 0)})`);
    selectA.appendChild(opt);
  }
  if (state.baseline) {
    selectB.appendChild(createEl('option', { value: 'baseline' }, 'baseline'));
  }

  runs.forEach(r => {
    const text = `${r.id} \u2014 ${pct(r.passRate)} (${shortDate(r.timestamp)})`;
    selectA.appendChild(createEl('option', { value: r.id }, text));
    selectB.appendChild(createEl('option', { value: r.id }, text));
  });

  if (runs.length > 1 && !state.baseline) selectB.selectedIndex = 1;

  document.getElementById('compare-btn').addEventListener('click', doCompare);
}

async function doCompare() {
  const aId = document.getElementById('compare-a').value;
  const bId = document.getElementById('compare-b').value;

  let runA, runB;
  if (aId === 'latest') runA = state.latest;
  else if (aId === 'baseline') runA = state.baseline;
  else runA = await api(`run/${aId}`);

  if (bId === 'latest') runB = state.latest;
  else if (bId === 'baseline') runB = state.baseline;
  else runB = await api(`run/${bId}`);

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
  const table = createEl('table', { className: 'compare-table' });
  const thead = createEl('thead');
  const headerRow = createEl('tr');
  ['Case', 'Difficulty', 'Run A', 'Run B', 'Delta'].forEach(h => {
    headerRow.appendChild(createEl('th', {}, h));
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = createEl('tbody');
  rows.forEach(r => {
    const tr = createEl('tr');
    const tdCase = createEl('td');
    tdCase.appendChild(createEl('strong', {}, r.case));
    tr.appendChild(tdCase);
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
  container.replaceChildren(table);
}

// === Rubrics ===
async function renderRubrics() {
  try {
    const rubrics = await api('rubrics');
    const container = document.getElementById('rubrics-content');
    if (!rubrics) {
      container.replaceChildren(createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No rubrics found')]));
      return;
    }

    container.replaceChildren(...Object.entries(rubrics).map(([key, val]) => {
      const card = createEl('div', { className: 'rubric-card' });
      card.appendChild(createEl('h2', {}, key));
      const prompt = createEl('div', { className: 'rubric-prompt' });
      prompt.textContent = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      card.appendChild(prompt);
      return card;
    }));
  } catch {
    const container = document.getElementById('rubrics-content');
    container.replaceChildren(createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'Could not load rubrics')]));
  }
}

// === Boot ===
init().catch(err => {
  console.error('Dashboard init failed:', err);
  const main = document.querySelector('.main');
  main.replaceChildren(
    createEl('div', { className: 'empty-state' }, [
      createEl('h2', {}, 'Failed to load'),
      createEl('p', {}, err.message),
    ])
  );
});
