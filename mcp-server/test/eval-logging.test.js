import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Helper: spawn the MCP server, wait for "Index built" on stderr,
 * then return { proc, stderrLines, send, waitForResponse, close }.
 *
 * The SDK uses newline-delimited JSON on stdio (NOT Content-Length framing).
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

    const stderrChunks = [];

    proc.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Timed out waiting for server to start"));
    }, 10_000);

    const onStderr = (chunk) => {
      if (chunk.toString().includes("Index built")) {
        clearTimeout(timeout);
        proc.stderr.removeListener("data", onStderr);

        // Buffer stdout lines for response parsing
        let stdoutBuf = "";
        const stdoutLines = [];
        let pendingResolve = null;

        proc.stdout.on("data", (d) => {
          stdoutBuf += d.toString();
          const parts = stdoutBuf.split("\n");
          // Keep last (possibly incomplete) part in buffer
          stdoutBuf = parts.pop();
          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) {
              stdoutLines.push(trimmed);
              if (pendingResolve) {
                const r = pendingResolve;
                pendingResolve = null;
                r(trimmed);
              }
            }
          }
        });

        resolve({
          proc,
          getStderrLines() {
            return stderrChunks.join("").split("\n").filter(Boolean);
          },
          send(obj) {
            proc.stdin.write(JSON.stringify(obj) + "\n");
          },
          waitForResponse(ms = 5_000) {
            // If we already have a buffered line, return it
            if (stdoutLines.length > 0) {
              return Promise.resolve(stdoutLines.shift());
            }
            return new Promise((res, rej) => {
              const timer = setTimeout(() => {
                pendingResolve = null;
                rej(new Error("Timed out waiting for MCP response"));
              }, ms);
              pendingResolve = (line) => {
                clearTimeout(timer);
                res(line);
              };
            });
          },
          close() {
            return new Promise((res) => {
              proc.on("close", res);
              proc.stdin.end();
            });
          },
        });
      }
    };
    proc.stderr.on("data", onStderr);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("eval logging", () => {
  let vaultDir;
  let dbDir;

  before(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "limbo-eval-test-"));
    dbDir = await mkdtemp(join(tmpdir(), "limbo-eval-db-"));
    await mkdir(join(vaultDir, "notes"), { recursive: true });
    await mkdir(join(vaultDir, "maps"), { recursive: true });
  });

  after(async () => {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  });

  it("logs tool_call and tool_result to stderr when LIMBO_EVAL=true", async () => {
    const { proc, getStderrLines, send, waitForResponse, close } =
      await startServer({
        VAULT_PATH: vaultDir,
        DB_PATH: dbDir,
        LIMBO_EVAL: "true",
      });

    // 1. Send MCP initialize
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "eval-test", version: "0.1.0" },
      },
    });
    await waitForResponse();

    // 2. Send initialized notification
    send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await new Promise((r) => setTimeout(r, 200));

    // 3. Call vault_write_note
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "vault_write_note",
        arguments: {
          id: "eval-test-note",
          title: "Eval Test Note",
          type: "fact",
          description: "A test note for eval logging",
          content: "# Test\nThis is a test note.",
        },
      },
    });
    await waitForResponse();

    await close();

    // Parse JSON lines from stderr
    const lines = getStderrLines();
    const jsonEvents = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

    // Find tool_call event
    const toolCall = jsonEvents.find(
      (e) => e.type === "tool_call" && e.tool === "vault_write_note"
    );
    assert.ok(toolCall, "should have a tool_call event for vault_write_note");
    assert.equal(toolCall.tool, "vault_write_note");
    assert.ok(toolCall.params.id, "tool_call params should include id");
    assert.ok(toolCall.timestamp, "tool_call should have a timestamp");

    // Find tool_result event
    const toolResult = jsonEvents.find(
      (e) => e.type === "tool_result" && e.tool === "vault_write_note"
    );
    assert.ok(
      toolResult,
      "should have a tool_result event for vault_write_note"
    );
    assert.equal(toolResult.success, true);
  });

  it("does NOT log when LIMBO_EVAL is not set", async () => {
    const { proc, getStderrLines, send, waitForResponse, close } =
      await startServer({
        VAULT_PATH: vaultDir,
        DB_PATH: dbDir,
        LIMBO_EVAL: undefined,
      });

    // Initialize
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "eval-test", version: "0.1.0" },
      },
    });
    await waitForResponse();

    send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await new Promise((r) => setTimeout(r, 200));

    // Call vault_search
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "vault_search",
        arguments: { query: "test" },
      },
    });
    await waitForResponse();

    await close();

    const lines = getStderrLines();
    const jsonEvents = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

    const toolEvents = jsonEvents.filter(
      (e) => e.type === "tool_call" || e.type === "tool_result"
    );
    assert.equal(
      toolEvents.length,
      0,
      "should NOT have any tool_call or tool_result events when LIMBO_EVAL is not set"
    );
  });
});
