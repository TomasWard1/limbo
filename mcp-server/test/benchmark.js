/**
 * Benchmark: old (filesystem scan) vs new (in-memory index)
 *
 * Creates a temporary vault with N notes, then compares:
 * - vault_search latency
 * - vault_read latency
 * - vault_write_note + subsequent search latency
 *
 * Run: node test/benchmark.js [noteCount]
 *   default noteCount = 200
 */

import { mkdir, writeFile, rm } from "fs/promises";
import { join, basename, relative } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// ── Scaffold a temp vault ──────────────────────────────────────────────────

const NOTE_COUNT = parseInt(process.argv[2] || "200", 10);
const VAULT_DIR = join(tmpdir(), `limbo-bench-${randomUUID().slice(0, 8)}`);
const NOTES_DIR = join(VAULT_DIR, "notes");
const MAPS_DIR = join(VAULT_DIR, "maps");

const DOMAINS = ["personal", "research", "projects", "aios", "limbo"];
const TYPES = ["fact", "preference", "idea", "insight", "decision"];

function generateNote(i) {
  const domain = DOMAINS[i % DOMAINS.length];
  const type = TYPES[i % TYPES.length];
  const id = `bench-note-${String(i).padStart(4, "0")}`;
  const title = `Benchmark note number ${i} about ${domain}`;
  const description = `This is test note ${i} in the ${domain} domain for performance benchmarking`;
  const body = [
    `This note contains searchable content for domain ${domain}.`,
    `Keywords: optimization, performance, latency, throughput, indexing.`,
    `Note index: ${i}. UUID: ${randomUUID()}.`,
    `The quick brown fox jumps over the lazy dog.`,
    i % 7 === 0 ? "Special keyword: UNIQUE_NEEDLE" : "",
    i % 3 === 0 ? `Reference to [[bench-note-${String(i - 1).padStart(4, "0")}]]` : "",
  ].join("\n\n");

  const frontmatter = [
    "---",
    `id: ${id}`,
    `title: "${title}"`,
    `description: "${description}"`,
    `type: ${type}`,
    `schema_version: 1`,
    `domain: ${domain}`,
    `created: "2026-03-19"`,
    `source: benchmark`,
    "topics:",
    `  - "[[${domain}-map]]"`,
    "---",
  ].join("\n");

  return { id, domain, content: `${frontmatter}\n\n${body}\n` };
}

async function scaffoldVault() {
  await mkdir(NOTES_DIR, { recursive: true });
  await mkdir(MAPS_DIR, { recursive: true });

  const writes = [];
  for (let i = 0; i < NOTE_COUNT; i++) {
    const { id, domain, content } = generateNote(i);
    const dir = join(NOTES_DIR, domain);
    writes.push(
      mkdir(dir, { recursive: true }).then(() =>
        writeFile(join(dir, `${id}.md`), content, "utf8")
      )
    );
  }
  await Promise.all(writes);
}

async function cleanup() {
  await rm(VAULT_DIR, { recursive: true, force: true });
}

// ── Old implementation (filesystem scan) ───────────────────────────────────

import { readdir, readFile, stat } from "fs/promises";

async function oldWalkNotes(dir, base = dir) {
  const entries = [];
  let items;
  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }
  for (const item of items) {
    if (item.startsWith(".") || item === "_meta") continue;
    const full = join(dir, item);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      const sub = await oldWalkNotes(full, base);
      entries.push(...sub);
    } else if (item.endsWith(".md")) {
      const rel = relative(base, dir);
      entries.push({ filePath: full, domain: rel || null });
    }
  }
  return entries;
}

function oldExtractTitle(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
  }
  return null;
}

async function oldSearch(query) {
  const files = await oldWalkNotes(NOTES_DIR);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const results = [];
  for (const { filePath, domain } of files) {
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const matches = content.match(regex);
    if (!matches) continue;
    const noteId = basename(filePath, ".md");
    const title = oldExtractTitle(content) || noteId;
    results.push({ noteId, title, score: matches.length, domain });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

async function oldRead(noteId) {
  // Fast path
  const flatPath = join(NOTES_DIR, `${noteId}.md`);
  try {
    await stat(flatPath);
    return await readFile(flatPath, "utf8");
  } catch {}

  // Recursive search
  async function searchDir(dir) {
    let items;
    try {
      items = await readdir(dir);
    } catch {
      return null;
    }
    for (const item of items) {
      if (item.startsWith(".") || item === "_meta") continue;
      const full = join(dir, item);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        const candidate = join(full, `${noteId}.md`);
        try {
          await stat(candidate);
          return await readFile(candidate, "utf8");
        } catch {
          const found = await searchDir(full);
          if (found) return found;
        }
      }
    }
    return null;
  }

  return searchDir(NOTES_DIR);
}

// ── New implementation (in-memory index) ───────────────────────────────────

// We inline the index here to avoid env var coupling with vault-index.js

const index = new Map();

function newExtractTitle(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
    const descMatch = fmMatch[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) return descMatch[1];
  }
  return null;
}

async function newWalkAndIndex(dir, base = dir) {
  let items;
  try {
    items = await readdir(dir);
  } catch {
    return;
  }
  const promises = [];
  for (const item of items) {
    if (item.startsWith(".") || item === "_meta") continue;
    const full = join(dir, item);
    promises.push(
      stat(full)
        .then((s) => {
          if (s.isDirectory()) return newWalkAndIndex(full, base);
          if (item.endsWith(".md")) {
            return readFile(full, "utf8")
              .then((content) => {
                const noteId = basename(full, ".md");
                const domain = relative(base, dir) || null;
                const title = newExtractTitle(content) || noteId;
                index.set(noteId, { path: full, title, content, domain });
              })
              .catch(() => {});
          }
        })
        .catch(() => {})
    );
  }
  await Promise.all(promises);
}

async function newBuildIndex() {
  index.clear();
  await newWalkAndIndex(NOTES_DIR);
  return index.size;
}

function newSearch(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const results = [];
  for (const [noteId, entry] of index) {
    const matches = entry.content.match(regex);
    if (!matches) continue;
    results.push({ noteId, title: entry.title, score: matches.length, domain: entry.domain });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function newRead(noteId) {
  const entry = index.get(noteId);
  return entry ? entry.content : null;
}

// ── Benchmark harness ──────────────────────────────────────────────────────

async function timeMs(fn, iterations = 1) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    min: times[0],
    median: times[Math.floor(times.length / 2)],
    max: times[times.length - 1],
    avg: times.reduce((a, b) => a + b, 0) / times.length,
  };
}

function fmt(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  return `${ms.toFixed(2)}ms`;
}

function printResult(label, old, now) {
  const speedup = old.median / now.median;
  console.log(`  ${label}`);
  console.log(`    OLD:  median=${fmt(old.median)}  avg=${fmt(old.avg)}  min=${fmt(old.min)}  max=${fmt(old.max)}`);
  console.log(`    NEW:  median=${fmt(now.median)}  avg=${fmt(now.avg)}  min=${fmt(now.min)}  max=${fmt(now.max)}`);
  console.log(`    Speedup: ${speedup.toFixed(1)}x faster`);
  console.log();
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\n=== Limbo MCP Benchmark ===`);
console.log(`Notes: ${NOTE_COUNT}`);
console.log(`Vault: ${VAULT_DIR}\n`);

try {
  // Setup
  console.log("Scaffolding vault...");
  await scaffoldVault();

  // Build index (one-time cost)
  console.log("Building index...");
  const buildTime = await timeMs(() => newBuildIndex(), 3);
  console.log(`  Index build: median=${fmt(buildTime.median)} (${index.size} notes)\n`);

  const ITERS = 20;

  // ── Search: broad query (many matches) ─────────────────────────────────
  console.log(`--- Search: broad query ("optimization") × ${ITERS} ---`);
  const oldSearchBroad = await timeMs(() => oldSearch("optimization"), ITERS);
  const newSearchBroad = await timeMs(() => newSearch("optimization"), ITERS);
  printResult("Broad search", oldSearchBroad, newSearchBroad);

  // ── Search: narrow query (few matches) ─────────────────────────────────
  console.log(`--- Search: narrow query ("UNIQUE_NEEDLE") × ${ITERS} ---`);
  const oldSearchNarrow = await timeMs(() => oldSearch("UNIQUE_NEEDLE"), ITERS);
  const newSearchNarrow = await timeMs(() => newSearch("UNIQUE_NEEDLE"), ITERS);
  printResult("Narrow search", oldSearchNarrow, newSearchNarrow);

  // ── Search: no matches ─────────────────────────────────────────────────
  console.log(`--- Search: miss ("xyzzy_nonexistent") × ${ITERS} ---`);
  const oldSearchMiss = await timeMs(() => oldSearch("xyzzy_nonexistent"), ITERS);
  const newSearchMiss = await timeMs(() => newSearch("xyzzy_nonexistent"), ITERS);
  printResult("Miss search", oldSearchMiss, newSearchMiss);

  // ── Read: note in subdirectory (worst case for old) ────────────────────
  console.log(`--- Read: note in subdirectory × ${ITERS} ---`);
  const readTarget = `bench-note-${String(Math.floor(NOTE_COUNT / 2)).padStart(4, "0")}`;
  const oldReadSub = await timeMs(() => oldRead(readTarget), ITERS);
  const newReadSub = await timeMs(() => newRead(readTarget), ITERS);
  printResult(`Read "${readTarget}"`, oldReadSub, newReadSub);

  // ── Read: nonexistent note ─────────────────────────────────────────────
  console.log(`--- Read: nonexistent note × ${ITERS} ---`);
  const oldReadMiss = await timeMs(() => oldRead("does-not-exist-999"), ITERS);
  const newReadMiss = await timeMs(() => newRead("does-not-exist-999"), ITERS);
  printResult("Read miss", oldReadMiss, newReadMiss);

  // ── Correctness check ──────────────────────────────────────────────────
  console.log("--- Correctness ---");
  const oldResults = await oldSearch("optimization");
  const newResults = newSearch("optimization");
  const oldCount = oldResults.length;
  const newCount = newResults.length;
  const match = oldCount === newCount;
  console.log(`  Old result count: ${oldCount}`);
  console.log(`  New result count: ${newCount}`);
  console.log(`  Match: ${match ? "PASS ✓" : "FAIL ✗"}`);
  if (!match) {
    console.log("  WARNING: result counts differ!");
  }

  // Verify read returns identical content
  const oldContent = await oldRead(readTarget);
  const newContent = newRead(readTarget);
  const readMatch = oldContent === newContent;
  console.log(`  Read content match: ${readMatch ? "PASS ✓" : "FAIL ✗"}`);
  console.log();

} finally {
  await cleanup();
  console.log("Cleaned up.\n");
}
