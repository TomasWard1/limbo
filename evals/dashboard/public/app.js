// === Limbo Eval Dashboard ===
// All dynamic text is escaped via escapeHtml() or textContent.
// No innerHTML with user data.

const state = {
  latest: null,
  baseline: null,
  cases: [],
  history: [],
  caseMap: {},
  expandedCase: null,
  expandedRun: null,
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

  state.caseMap = {};
  cases.forEach(c => { state.caseMap[c.name] = c; });

  setupNav();
  renderOverview();
  renderSpeed();
  renderHistory();
  renderCompareSelectors();
  setupFilters();
}

// === Navigation ===
function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      showView(tab.dataset.view);
    });
  });
}

function showView(viewId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  const tab = document.querySelector(`[data-view="${viewId}"]`);
  if (tab) tab.classList.add('active');
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
  if (rate >= 0.7) return 'var(--amber)';
  return 'var(--red)';
}

function isSpeedCase(caseName) {
  const def = state.caseMap[caseName];
  if (!def || !def.tags) return false;
  return def.tags.includes('speed') || def.tags.includes('vault_search');
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

// === Overview ===
function renderOverview() {
  const run = state.latest;
  if (!run) {
    document.getElementById('view-overview').replaceChildren(
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

  // Speed cases avg latency
  const speedLatencies = run.results
    .filter(r => isSpeedCase(r.case) && typeof r.latencyMs === 'number' && r.latencyMs > 0)
    .map(r => r.latencyMs);
  const avgSpeedLatency = speedLatencies.length
    ? Math.round(speedLatencies.reduce((a, b) => a + b, 0) / speedLatencies.length)
    : null;

  document.getElementById('overview-stats').replaceChildren(
    buildStatCard('Pass Rate', pct(overallRate), statusOf(overallRate), `${totalPassed}/${totalAssertions} assertions`),
    buildStatCard('Cases', String(run.results.length), 'neutral', `${casesFullPass} passed, ${casesFailed} failed`),
    buildStatCard('Avg Latency (speed)', avgSpeedLatency ? `${(avgSpeedLatency / 1000).toFixed(1)}s` : '\u2014', avgSpeedLatency && avgSpeedLatency < 15000 ? 'pass' : avgSpeedLatency ? 'partial' : 'neutral', speedLatencies.length ? `${speedLatencies.length} speed cases` : 'no speed cases'),
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
    if (typeof r.latencyMs === 'number' && r.latencyMs > 0) {
      row.appendChild(createEl('div', { className: 'result-latency' }, `${(r.latencyMs / 1000).toFixed(1)}s`));
    } else {
      row.appendChild(createEl('div', { className: 'result-latency' }, ''));
    }
    row.appendChild(statusPill(status));

    row.addEventListener('click', () => {
      toggleAccordion(container, r.case, r, row);
    });
    children.push(row);
  });

  container.replaceChildren(...children);
}

function toggleAccordion(container, caseName, result, rowEl) {
  // Close existing accordion if any
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
  const caseDef = state.caseMap[caseName];
  const el = createEl('div', { className: 'accordion-detail' });

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
      const pat = createEl('div', { style: { fontSize: '11px', color: 'var(--slate-400)', marginTop: '2px' } });
      pat.textContent = `pattern: ${sr.assertion.pattern}`;
      info.appendChild(pat);
    }
    row.appendChild(info);
    assertSection.appendChild(row);
  });
  el.appendChild(assertSection);

  // Response
  const respSection = createEl('div', { className: 'detail-section' });
  respSection.appendChild(createEl('h3', {}, 'LLM Response'));
  respSection.appendChild(createEl('div', { className: 'response-box', textContent: result.response || '(no response captured)' }));
  el.appendChild(respSection);

  // Vault Changes
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
    el.appendChild(judgeSection);
  }

  return el;
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
      results = results.filter(r => r.case.toLowerCase().includes(search));
    }

    renderResultsList(results);
  };

  diffFilter.addEventListener('change', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  searchFilter.addEventListener('input', applyFilters);
}

// === Speed Tab ===
function renderSpeed() {
  const run = state.latest;
  if (!run) {
    document.getElementById('view-speed').replaceChildren(
      createEl('h1', {}, 'Speed'),
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No results yet')])
    );
    return;
  }

  const speedResults = run.results.filter(r => isSpeedCase(r.case));

  if (!speedResults.length) {
    document.getElementById('speed-stats').replaceChildren();
    document.getElementById('speed-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No speed cases found')])
    );
    document.getElementById('speed-results').replaceChildren();
    return;
  }

  const latencies = speedResults
    .filter(r => typeof r.latencyMs === 'number' && r.latencyMs > 0)
    .map(r => r.latencyMs);
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const max = latencies.length ? Math.max(...latencies) : null;
  const min = latencies.length ? Math.min(...latencies) : null;

  // Stats
  document.getElementById('speed-stats').replaceChildren(
    buildStatCard('Avg Latency', avg ? `${(avg / 1000).toFixed(1)}s` : '\u2014', avg && avg < 15000 ? 'pass' : avg ? 'partial' : 'neutral', `${latencies.length} cases`),
    buildStatCard('Fastest', min ? `${(min / 1000).toFixed(1)}s` : '\u2014', 'pass', ''),
    buildStatCard('Slowest', max ? `${(max / 1000).toFixed(1)}s` : '\u2014', max && max > 20000 ? 'fail' : 'partial', ''),
  );

  // Bar chart
  const maxLatency = Math.max(...latencies, 1);

  // Check for baseline speed data
  let baselineSpeedMap = {};
  if (state.baseline) {
    state.baseline.results.forEach(r => {
      if (isSpeedCase(r.case) && typeof r.latencyMs === 'number') {
        baselineSpeedMap[r.case] = r.latencyMs;
      }
    });
  }

  const chartEl = document.getElementById('speed-chart');
  chartEl.replaceChildren();
  chartEl.appendChild(createEl('h3', { style: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: 'var(--slate-700)' } }, 'Latency by Case'));

  if (Object.keys(baselineSpeedMap).length > 0) {
    const legend = createEl('div', { style: { display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px', color: 'var(--slate-400)' } });
    legend.appendChild(createEl('span', {}, 'Latest (bar)'));
    legend.appendChild(createEl('span', {}, 'Baseline (line)'));
    chartEl.appendChild(legend);
  }

  const bars = createEl('div', { className: 'speed-bars' });
  speedResults.forEach(r => {
    const latency = r.latencyMs || 0;
    const pctWidth = maxLatency ? (latency / maxLatency) * 100 : 0;
    const speedClass = latency < 10000 ? 'fast' : latency < 20000 ? 'medium' : 'slow';

    const row = createEl('div', { className: 'speed-bar-row' });
    row.appendChild(createEl('div', { className: 'speed-bar-label', textContent: r.case }));

    const track = createEl('div', { className: 'speed-bar-track' });
    const fill = createEl('div', { className: `speed-bar-fill ${speedClass}` });
    fill.style.width = `${pctWidth}%`;
    track.appendChild(fill);

    // Baseline marker
    const baselineMs = baselineSpeedMap[r.case];
    if (baselineMs) {
      const baselinePct = (baselineMs / maxLatency) * 100;
      const marker = createEl('div', { className: 'speed-bar-baseline' });
      marker.style.left = `${baselinePct}%`;
      marker.title = `Baseline: ${(baselineMs / 1000).toFixed(1)}s`;
      track.appendChild(marker);
    }

    row.appendChild(track);
    row.appendChild(createEl('div', { className: 'speed-bar-value' }, latency ? `${(latency / 1000).toFixed(1)}s` : '\u2014'));
    bars.appendChild(row);
  });
  chartEl.appendChild(bars);

  // Results list for speed cases
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
    row.appendChild(createEl('div', { className: 'result-latency' }, typeof r.latencyMs === 'number' ? `${(r.latencyMs / 1000).toFixed(1)}s` : '\u2014'));
    row.appendChild(statusPill(status));

    row.addEventListener('click', () => {
      toggleAccordion(speedList, r.case, r, row);
    });
    children.push(row);
  });
  speedList.replaceChildren(...children);
}

// === History ===
function renderHistory() {
  const runs = state.history;
  if (!runs.length) {
    document.getElementById('history-chart').replaceChildren(
      createEl('div', { className: 'empty-state' }, [createEl('h2', {}, 'No history yet')])
    );
    document.getElementById('history-list').replaceChildren();
    return;
  }

  // Bar chart
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
      const runData = await api(`run/${r.id}`);
      showHistoryRunDetail(runData, runDetailContainer);
    });
    barsEl.appendChild(wrapper);
  });
  chartContainer.appendChild(barsEl);
  chartContainer.after(runDetailContainer);

  // Run list
  const listEl = document.getElementById('history-list');
  listEl.replaceChildren(...runs.map(r => {
    const row = createEl('div', { className: 'history-row', 'data-run-id': r.id });
    const info = createEl('div');
    info.appendChild(createEl('div', { className: 'run-label' }, r.id));
    info.appendChild(createEl('div', { className: 'run-date' }, formatDate(r.timestamp)));
    row.appendChild(info);
    row.appendChild(createEl('div', { style: { fontSize: '12px', color: 'var(--slate-500)' } }, `${r.caseCount} cases`));
    row.appendChild(createEl('div', { className: `result-score ${statusOf(r.passRate)}` }, `${r.totalPassed}/${r.totalAssertions}`));
    row.appendChild(statusPill(statusOf(r.passRate)));
    row.addEventListener('click', async () => {
      const runData = await api(`run/${r.id}`);
      const container = document.getElementById('history-run-detail-container');
      showHistoryRunDetail(runData, container);
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return row;
  }));
}

function showHistoryRunDetail(runData, container) {
  // If same run is already expanded, close it
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

  // Header with close
  const header = createEl('div', { className: 'detail-header' });
  const titleRow = createEl('div');
  titleRow.appendChild(createEl('div', { className: 'detail-title', textContent: runData.id }));
  titleRow.appendChild(createEl('div', { style: { fontSize: '12px', color: 'var(--slate-400)', marginTop: '2px' } }, formatDate(runData.timestamp)));
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

  // Results as accordion
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
    if (typeof r.latencyMs === 'number' && r.latencyMs > 0) {
      row.appendChild(createEl('div', { className: 'result-latency' }, `${(r.latencyMs / 1000).toFixed(1)}s`));
    } else {
      row.appendChild(createEl('div', { className: 'result-latency' }, ''));
    }
    row.appendChild(statusPill(status));
    row.addEventListener('click', () => {
      toggleAccordion(resultsList, r.case, r, row);
    });
    resultsList.appendChild(row);
  });
  detail.appendChild(resultsList);
  container.replaceChildren(detail);
}

// === Compare ===
function renderCompareSelectors() {
  const runs = state.history;
  const selectA = document.getElementById('compare-a');
  const selectB = document.getElementById('compare-b');

  selectA.replaceChildren();
  selectB.replaceChildren();

  if (state.latest) {
    const totalP = state.latest.results.reduce((s, r) => s + r.passed, 0);
    const totalA = state.latest.results.reduce((s, r) => s + r.total, 0);
    selectA.appendChild(createEl('option', { value: 'latest' }, `latest (${pct(totalA ? totalP / totalA : 0)})`));
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
  container.replaceChildren(table);
}

// === Boot ===
init().catch(err => {
  console.error('Dashboard init failed:', err);
  document.querySelector('.main').replaceChildren(
    createEl('div', { className: 'empty-state' }, [
      createEl('h2', {}, 'Failed to load'),
      createEl('p', {}, err.message),
    ])
  );
});
