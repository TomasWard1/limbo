import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

/**
 * Helper: spawn the MCP server, wait for "Index built" on stderr,
 * then return { send, callTool, close }.
 */
function startServer(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "node",
      [join(import.meta.dirname, "..", "index.js")],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      }
    );

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Timed out waiting for server to start"));
    }, 10_000);

    const onStderr = (chunk) => {
      if (chunk.toString().includes("Index built")) {
        clearTimeout(timeout);
        proc.stderr.removeListener("data", onStderr);

        let stdoutBuf = "";
        let nextId = 1;
        const pending = new Map(); // id → { resolve, reject, timer }

        proc.stdout.on("data", (d) => {
          stdoutBuf += d.toString();
          const parts = stdoutBuf.split("\n");
          stdoutBuf = parts.pop();
          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.id != null && pending.has(msg.id)) {
                const p = pending.get(msg.id);
                pending.delete(msg.id);
                clearTimeout(p.timer);
                p.resolve(msg);
              }
            } catch {
              // ignore non-JSON
            }
          }
        });

        function sendAndWait(obj, ms = 5_000) {
          const id = nextId++;
          obj = { ...obj, id, jsonrpc: "2.0" };
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`Timed out waiting for response to id=${id}`));
            }, ms);
            pending.set(id, { resolve: res, reject: rej, timer });
            proc.stdin.write(JSON.stringify(obj) + "\n");
          });
        }

        function send(obj) {
          proc.stdin.write(JSON.stringify({ ...obj, jsonrpc: "2.0" }) + "\n");
        }

        // Auto-initialize
        sendAndWait({
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0.1.0" },
          },
        }).then(() => {
          send({ method: "notifications/initialized" });
          // Give server a moment to process notification
          setTimeout(() => {
            resolve({
              callTool(name, args) {
                return sendAndWait({
                  method: "tools/call",
                  params: { name, arguments: args },
                });
              },
              close() {
                return new Promise((res) => {
                  proc.on("close", res);
                  proc.stdin.end();
                });
              },
            });
          }, 100);
        }).catch(reject);
      }
    };
    proc.stderr.on("data", onStderr);
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("vault_get_file — telegram-first file references", () => {
  let vaultDir;
  let dbDir;

  before(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "limbo-getfile-test-"));
    dbDir = await mkdtemp(join(tmpdir(), "limbo-getfile-db-"));
    await mkdir(join(vaultDir, "notes"), { recursive: true });
    await mkdir(join(vaultDir, "maps"), { recursive: true });
    await mkdir(join(vaultDir, "assets"), { recursive: true });

    // Create a small PNG (1x1 pixel, ~67 bytes)
    const smallPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    await writeFile(join(vaultDir, "assets", "small.png"), smallPng);

    // Create a "large" image (>512KB base64 = >384KB raw)
    const largeBuffer = Buffer.alloc(400 * 1024, 0x42); // 400KB raw → ~533KB base64
    await writeFile(join(vaultDir, "assets", "large.png"), largeBuffer);

    // Create a PDF file (any size — PDFs are never inline)
    const pdfBuffer = Buffer.from("%PDF-1.4 fake pdf content for testing");
    await writeFile(join(vaultDir, "assets", "doc.pdf"), pdfBuffer);

    // Note linking to small image
    await writeFile(
      join(vaultDir, "notes", "small-image.md"),
      [
        "---",
        "id: small-image",
        "title: Small Image",
        "description: A tiny test image",
        "type: source",
        "asset_path: assets/small.png",
        "---",
        "",
        "A small test image.",
      ].join("\n")
    );

    // Note linking to large image
    await writeFile(
      join(vaultDir, "notes", "large-image.md"),
      [
        "---",
        "id: large-image",
        "title: Large Image",
        "description: A large test image",
        "type: source",
        "asset_path: assets/large.png",
        "---",
        "",
        "A large test image.",
      ].join("\n")
    );

    // Note linking to PDF
    await writeFile(
      join(vaultDir, "notes", "test-pdf.md"),
      [
        "---",
        "id: test-pdf",
        "title: Test PDF",
        "description: A test PDF document",
        "type: source",
        "asset_path: assets/doc.pdf",
        "---",
        "",
        "A PDF document.",
      ].join("\n")
    );
  });

  after(async () => {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  });

  it("returns small images as metadata references for attachment delivery", async () => {
    const server = await startServer({ VAULT_PATH: vaultDir, DB_PATH: dbDir });
    const response = await server.callTool("vault_get_file", { noteId: "small-image" });
    await server.close();

    const content = response.result.content;
    assert.ok(Array.isArray(content), "content should be an array");

    const textBlock = content.find((b) => b.type === "text");
    assert.ok(textBlock, "should have a text block with metadata");
    assert.match(textBlock.text, /small\.png/);
    assert.match(textBlock.text, /image\/png/);
    assert.match(textBlock.text, /Absolute path:/);
    assert.match(textBlock.text, /\[DOCUMENT:/);
  });

  it("returns large images as metadata reference (no base64 in response)", async () => {
    const server = await startServer({ VAULT_PATH: vaultDir, DB_PATH: dbDir });
    const response = await server.callTool("vault_get_file", { noteId: "large-image" });
    await server.close();

    const content = response.result.content;
    assert.ok(Array.isArray(content), "content should be an array");

    // Should have a text block with metadata
    const textBlock = content.find((b) => b.type === "text");
    assert.ok(textBlock, "should have a text block");
    assert.match(textBlock.text, /large\.png/, "should mention filename");
    assert.match(textBlock.text, /image\/png/, "should mention mime type");
    assert.match(textBlock.text, /assets\/large\.png/, "should include asset path");
    assert.match(textBlock.text, /\[DOCUMENT:/, "should include DOCUMENT reference");

    // Ensure no base64 data leaked into the response
    const totalLength = content.reduce(
      (sum, b) => sum + (b.text || "").length + (b.data || "").length,
      0
    );
    assert.ok(totalLength < 2000, `response should be small metadata, got ${totalLength} chars`);
  });

  it("returns PDFs as metadata reference (never inline)", async () => {
    const server = await startServer({ VAULT_PATH: vaultDir, DB_PATH: dbDir });
    const response = await server.callTool("vault_get_file", { noteId: "test-pdf" });
    await server.close();

    const content = response.result.content;

    // Should have metadata text
    const textBlock = content.find((b) => b.type === "text");
    assert.ok(textBlock);
    assert.match(textBlock.text, /doc\.pdf/);
    assert.match(textBlock.text, /application\/pdf/);
    assert.match(textBlock.text, /\[DOCUMENT:/);
  });

  it("returns error for non-existent note", async () => {
    const server = await startServer({ VAULT_PATH: vaultDir, DB_PATH: dbDir });
    const response = await server.callTool("vault_get_file", { noteId: "nonexistent" });
    await server.close();

    assert.ok(response.result.isError, "should be an error");
    assert.match(response.result.content[0].text, /not found/i);
  });
});
