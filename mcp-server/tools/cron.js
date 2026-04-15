import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VALID_SCHEDULE_KINDS = new Set(["at", "every", "cron"]);
const VALID_SESSION_TARGETS = new Set(["main", "isolated"]);

function resolveOpenClawBin() {
  return process.env.OPENCLAW_BIN || "openclaw";
}

function resolveTimeoutMs() {
  const raw = Number(process.env.CRON_GATEWAY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

async function runOpenClawCron(args) {
  const { stdout, stderr } = await execFileAsync(resolveOpenClawBin(), ["cron", ...args], {
    encoding: "utf8",
    timeout: resolveTimeoutMs(),
    env: process.env,
  }).catch((err) => {
    const detail = (err.stderr || err.stdout || err.message || "").trim();
    throw new Error(detail || `openclaw cron ${args[0]} failed`);
  });

  const text = (stdout || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    const detail = (stderr || text).trim();
    throw new Error(`Failed to parse openclaw cron JSON: ${detail || err.message}`);
  }
}

function mapListJob(job) {
  return {
    id: job.id,
    name: job.name || null,
    enabled: job.enabled !== false,
    schedule: job.schedule,
    payload: job.payload ? { kind: job.payload.kind, text: job.payload.text, message: job.payload.message } : null,
    delivery: job.delivery || null,
    nextRun: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null,
    lastRun: job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null,
    lastStatus: job.state?.lastStatus || null,
  };
}

function appendScheduleArgs(args, schedule) {
  if (!schedule || typeof schedule !== "object") {
    throw new Error('Required field "schedule" must be an object with { kind, ... }');
  }
  if (!VALID_SCHEDULE_KINDS.has(schedule.kind)) {
    throw new Error(`schedule.kind must be one of: ${[...VALID_SCHEDULE_KINDS].join(", ")}`);
  }

  if (schedule.kind === "at") {
    if (!schedule.at) throw new Error('schedule.kind "at" requires "at" (ISO-8601 timestamp)');
    const d = new Date(schedule.at);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${schedule.at}`);
    args.push("--at", schedule.at);
    return;
  }

  if (schedule.kind === "every") {
    if (!schedule.everyMs || typeof schedule.everyMs !== "number" || schedule.everyMs < 1000) {
      throw new Error('schedule.kind "every" requires "everyMs" (minimum 1000ms)');
    }
    args.push("--every", `${Math.floor(schedule.everyMs)}ms`);
    return;
  }

  if (!schedule.expr || typeof schedule.expr !== "string") {
    throw new Error('schedule.kind "cron" requires "expr" (cron expression)');
  }
  args.push("--cron", schedule.expr);
  if (schedule.tz) args.push("--tz", schedule.tz);
}

function appendDeliveryArgs(args, delivery) {
  if (!delivery || typeof delivery !== "object") return;

  if (delivery.mode === "none") {
    args.push("--no-deliver");
  } else if (delivery.mode === "announce" || delivery.mode == null) {
    args.push("--announce");
  } else {
    throw new Error(`Unsupported delivery.mode for cron_add: ${delivery.mode}`);
  }

  if (delivery.channel) args.push("--channel", delivery.channel);
  if (delivery.to) args.push("--to", delivery.to);
  if (delivery.accountId) args.push("--account", delivery.accountId);
  if (delivery.bestEffort === true) args.push("--best-effort-deliver");
}

export async function cronList({ includeDisabled } = {}) {
  const args = ["list", "--json"];
  if (includeDisabled) args.push("--all");

  const data = await runOpenClawCron(args);
  return (data?.jobs || []).map(mapListJob);
}

export async function cronAdd({ name, schedule, prompt, sessionTarget, delivery, deleteAfterRun }) {
  if (!name || typeof name !== "string") {
    throw new Error('Required field "name" must be a non-empty string');
  }
  if (!prompt || typeof prompt !== "string") {
    throw new Error('Required field "prompt" must be a non-empty string');
  }

  const resolvedTarget = VALID_SESSION_TARGETS.has(sessionTarget) ? sessionTarget : "isolated";
  const args = ["add", "--json", "--name", name];

  appendScheduleArgs(args, schedule);

  if (resolvedTarget === "main") {
    args.push("--session", "main", "--system-event", prompt);
  } else {
    args.push("--session", "isolated", "--message", prompt);
    appendDeliveryArgs(args, delivery);
  }

  if (schedule.kind === "at") {
    if (deleteAfterRun !== false) args.push("--delete-after-run");
    else args.push("--keep-after-run");
  } else if (deleteAfterRun === true) {
    args.push("--delete-after-run");
  }

  const job = await runOpenClawCron(args);
  return {
    id: job.id,
    name: job.name || name,
    schedule: job.schedule || schedule,
  };
}

export async function cronRemove({ jobId }) {
  if (!jobId || typeof jobId !== "string") {
    throw new Error('Required field "jobId" must be a non-empty string');
  }

  const result = await runOpenClawCron(["remove", "--json", jobId]);
  if (!result?.removed) {
    throw new Error(`Cron job not found: ${jobId}`);
  }

  return { id: jobId, name: null, removed: true };
}
