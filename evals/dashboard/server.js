#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3737;
const EVALS_DIR = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// API routes
const api = {
  '/api/cases'() {
    const casesDir = path.join(EVALS_DIR, 'cases');
    const files = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));
    return files.map(f => readJSON(path.join(casesDir, f)));
  },

  '/api/latest'() {
    const p = path.join(EVALS_DIR, 'results', 'latest.json');
    return fs.existsSync(p) ? readJSON(p) : null;
  },

  '/api/baseline'() {
    const p = path.join(EVALS_DIR, 'results', 'baseline.json');
    return fs.existsSync(p) ? readJSON(p) : null;
  },

  '/api/history'() {
    const dir = path.join(EVALS_DIR, 'results', 'history');
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    return files.map(f => {
      const run = readJSON(path.join(dir, f));
      // Return summary for list view (don't send all scoreResults)
      const totalPassed = run.results.reduce((s, r) => s + r.passed, 0);
      const totalAssertions = run.results.reduce((s, r) => s + r.total, 0);
      return {
        id: run.id,
        timestamp: run.timestamp,
        caseCount: run.results.length,
        totalPassed,
        totalAssertions,
        passRate: totalAssertions ? totalPassed / totalAssertions : 0,
      };
    });
  },

  '/api/run/:id'(params) {
    const dir = path.join(EVALS_DIR, 'results', 'history');
    const file = `${params.id}.json`;
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return null;
    return readJSON(p);
  },

  '/api/rubrics'() {
    const p = path.join(EVALS_DIR, 'judge', 'rubrics.json');
    return fs.existsSync(p) ? readJSON(p) : null;
  },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;

  // API routing
  if (pathname.startsWith('/api/')) {
    // Check parameterized routes
    const runMatch = pathname.match(/^\/api\/run\/(.+)$/);
    if (runMatch) {
      const data = api['/api/run/:id']({ id: runMatch[1] });
      if (!data) return jsonRes(res, { error: 'Not found' }, 404);
      return jsonRes(res, data);
    }

    const handler = api[pathname];
    if (handler) {
      try {
        return jsonRes(res, handler());
      } catch (e) {
        return jsonRes(res, { error: e.message }, 500);
      }
    }
    return jsonRes(res, { error: 'Not found' }, 404);
  }

  // Static files from dashboard/public
  const filePath = path.join(__dirname, 'public', pathname);
  const ext = path.extname(filePath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  🔥 Limbo Eval Dashboard → http://localhost:${PORT}\n`);
});
