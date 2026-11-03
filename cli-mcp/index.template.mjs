#!/usr/bin/env node
/**
 * cli-mcp — minimal stdio MCP server that exposes coding-agent CLIs
 * (claude / codex / codebuddy / qwen / agy) as MCP tools.
 *
 * Template: replace all <YOUR-*> tokens with your own values.
 * No dependencies, Node 18+.
 *
 * Env vars:
 *   DSH_CLI_MCP_TOOLS    tool name prefix, e.g. "cc_" -> tool "cc_ask"
 *   DSH_CLI_MCP_CWD      default working directory for the child
 *   DSH_CLI_MCP_TIMEOUT  max seconds per call, default 240
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PREFIX = process.env.DSH_CLI_MCP_TOOLS || "cli_";
const DEFAULT_CWD = process.env.DSH_CLI_MCP_CWD || process.cwd();
const DEFAULT_TIMEOUT_SEC = Number(process.env.DSH_CLI_MCP_TIMEOUT || 240);

// ---------- Windows PATH additions ----------
// On Windows, npm global bins may not be on the PATH of a spawned node process.
// Replace with YOUR npm global bin dir(s).
const WIN_PATH_ADDITIONS = process.platform === "win32"
  ? [
      "C:\\Program Files\\nodejs",
      // <YOUR-NPM-GLOBAL-BIN-DIR>          e.g. "C:\\Users\\HUAWEI\\AppData\\Roaming\\npm"
      // <YOUR-CODEX-BIN-DIR>               e.g. "C:\\Users\\HUAWEI\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin"
    ]
  : [];
const PATCHED_PATH = [WIN_PATH_ADDITIONS.filter(Boolean).join(";"), process.env.PATH || ""].join(";");

// ---------- qwen API key (optional) ----------
// Reads QWENCLOUD_API_KEY from ~/.qwen/settings.json. Only used by qwen spec.
let qwenApiKeyCache = null;
function readQwenApiKey() {
  if (qwenApiKeyCache !== null) return qwenApiKeyCache;
  qwenApiKeyCache = "";
  try {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const p = path.join(home, ".qwen", "settings.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8"));
      qwenApiKeyCache = j.QWENCLOUD_API_KEY || j.apiKey || "";
    }
  } catch {}
  return qwenApiKeyCache;
}

// ---------- Engine specs ----------
const ENGINES = {
  claude: {
    bin: "claude",
    args: (p, o) => [
      "-p", p,
      "--output-format", "json",
      ...(o.tools ? ["--allowedTools", Array.isArray(o.tools) ? o.tools.join(",") : String(o.tools)] : []),
      ...(o.model ? ["--model", o.model] : []),
      ...(o.maxTurns ? ["--max-turns", String(o.maxTurns)] : []),
    ],
    parse(stdout) {
      const t = stdout.trim();
      if (!t) return { answer: "", raw: true };
      try {
        const j = JSON.parse(t);
        return {
          answer: j.result ?? j.message ?? t,
          raw: false,
          meta: { is_error: j.is_error ?? null, num_turns: j.num_turns ?? null, cost_usd: j.total_cost_usd ?? null, model: j.modelUsage ? Object.keys(j.modelUsage)[0] : null, duration_ms: j.duration_ms ?? null },
        };
      } catch { return { answer: t, raw: true }; }
    },
  },

  codex: {
    bin: "codex",
    stdio: "stdin", // codex exec reads prompt from stdin
    args: (p, o) => {
      const q = (s) => (process.platform === "win32" ? `"${s}"` : s);
      return [
        "exec",
        ...(o.fullAuto ? ["--full-auto"] : []),
        ...(o.model ? ["--model", o.model] : []), // default gpt-6.1-sol; pass "gpt-6-astra" for complex tasks
        "--skip-git-repo-check",
        "--json",
      ];
    },
    parse(stdout) {
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      let lastMsg = null, status = "unknown";
      for (const line of lines) {
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.item?.type === "agent_message") lastMsg = j.item.text ?? j.item.message;
        if (j.type === "turn.completed" || j.item?.type === "item.completed") status = "completed";
        if (j.type === "error") status = "error";
      }
      return { answer: lastMsg ?? "", raw: lastMsg === null, meta: { status, events: lines.length } };
    },
  },

  codebuddy: {
    bin: "codebuddy",
    args: (p, o) => [
      "-p", p,
      "--output-format", "json",
      ...(o.tools ? ["--allowedTools", Array.isArray(o.tools) ? o.tools.join(",") : String(o.tools)] : []),
    ],
    parse(stdout) {
      const t = stdout.trim();
      if (!t) return { answer: "", raw: true };
      const lines = t.split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const j = JSON.parse(lines[i]);
          if (j.type === "result") return { answer: j.result ?? j.message ?? "", raw: false, meta: { duration_ms: j.duration_ms, total_cost_usd: j.total_cost_usd, num_turns: j.num_turns, usage: j.usage, session_id: j.session_id, is_error: j.is_error ?? false } };
        } catch {}
      }
      try {
        const j = JSON.parse(t);
        if (Array.isArray(j)) {
          for (let i = j.length - 1; i >= 0; i--) {
            if (j[i]?.type === "result") return { answer: j[i].result ?? j[i].message ?? "", raw: false, meta: { duration_ms: j[i].duration_ms, num_turns: j[i].num_turns, session_id: j[i].session_id, is_error: j[i].is_error ?? false } };
          }
        } else if (j.result !== undefined || j.message !== undefined) {
          return { answer: j.result ?? j.message ?? "", raw: false, meta: { duration_ms: j.duration_ms, num_turns: j.num_turns, is_error: j.is_error ?? false } };
        }
      } catch {}
      return { answer: t, raw: true };
    },
  },

  qwen: {
    bin: "node",
    stdio: "ignore",
    // Replace with YOUR qwen-code package dir (forward slashes on Windows!):
    cwd: "<QWEN_CODE_PACKAGE_DIR>",  // e.g. "D:/npm-global/node_modules/@qwen-code/qwen-code"
    args: (p, o) => {
      const entry = "<QWEN_CODE_PACKAGE_DIR>/cli.js";
      const q = (s) => (process.platform === "win32" ? `"${s}"` : s);
      return [entry, "--prompt", q(p), "--output-format", "json", ...(o.model ? ["--model", o.model] : [])];
    },
    shell: false, // bare node, no cmd.exe (preserves argv[1] for isMain check)
    extraEnv() {
      const env = {};
      const key = readQwenApiKey();
      if (key) env.QWENCLOUD_API_KEY = key;
      env.QWEN_CODE_NO_RELAUNCH = "true";
      // Replace with YOUR qwen home dir (forward slashes!):
      const qwenHome = "<QWEN_HOME_DIR>";  // e.g. "C:/Users/HUAWEI/.qwen"
      try { if (existsSync(qwenHome)) env.QWEN_HOME = qwenHome; } catch {}
      return env;
    },
    parse(stdout) {
      const t = stdout.trim();
      if (!t) return { answer: "", raw: true };
      try {
        const j = JSON.parse(t);
        if (j && typeof j === "object" && !Array.isArray(j)) {
          return { answer: j.result ?? j.message ?? j.output ?? "", raw: false, meta: { is_error: j.isError ?? false, duration_ms: j.durationMs ?? null, usage: j.usage ?? null, stop_reason: j.stopReason ?? null } };
        }
      } catch {}
      const ls = t.split(/\r?\n/).filter(Boolean);
      for (let i = ls.length - 1; i >= 0; i--) {
        try {
          const j = JSON.parse(ls[i]);
          if (j && typeof j === "object" && (j.result !== undefined || j.message !== undefined)) {
            return { answer: j.result ?? j.message ?? "", raw: false, meta: { is_error: j.isError ?? false, duration_ms: j.durationMs ?? null, usage: j.usage ?? null } };
          }
        } catch {}
      }
      return { answer: t, raw: true };
    },
  },

  agy: {
    // Antigravity CLI (Go binary). Replace with YOUR agy.exe path.
    bin: "<AGY_EXE_PATH>",  // e.g. "C:\\Users\\HUAWEI\\AppData\\Local\\agy\\bin\\agy.exe"
    stdio: "ignore",
    args: (p, o) => {
      const q = (s) => (process.platform === "win32" ? `"${s}"` : s);
      return ["-p", q(p), "--output-format", "json", ...(o.model ? ["--model", o.model] : []), ...(o.effort ? ["--effort", o.effort] : [])];
    },
    parse(stdout) {
      const t = stdout.trim();
      if (!t) return { answer: "", raw: true };
      try {
        const j = JSON.parse(t);
        if (j && typeof j === "object" && !Array.isArray(j)) {
          return { answer: j.response ?? j.message ?? "", raw: false, meta: { status: j.status ?? null, error: j.error ?? null, duration_seconds: j.duration_seconds ?? null, num_turns: j.num_turns ?? null, usage: j.usage ?? null } };
        }
      } catch {}
      return { answer: t, raw: true };
    },
  },
};

// ---------- Run engine ----------
function runEngine(engine, prompt, opts = {}) {
  const spec = ENGINES[engine];
  if (!spec) return Promise.reject(new Error(`unknown engine "${engine}"; available: ${Object.keys(ENGINES).join(", ")}`));
  const args = spec.args(prompt, opts);
  const cwd = opts.cwd || spec.cwd || DEFAULT_CWD;
  const timeoutSec = Number(opts.timeoutSec) || DEFAULT_TIMEOUT_SEC;
  const useStdin = spec.stdio !== "ignore";
  return new Promise((resolve, reject) => {
    let child;
    try {
      const extra = spec.extraEnv ? spec.extraEnv() : {};
      child = spawn(spec.bin, args, {
        cwd,
        env: {
          ...process.env,
          PATH: PATCHED_PATH,
          CI: "1",
          NO_COLOR: "1",
          CODEX_DISABLE_SANDBOX: "1",
          // Replace with YOUR proxy (or delete these lines if no proxy):
          // HTTP_PROXY: "http://<YOUR_PROXY>",
          // HTTPS_PROXY: "http://<YOUR_PROXY>",
          // ALL_PROXY: "http://<YOUR_PROXY>",
          ...extra,
        },
        stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
        shell: spec.shell !== undefined ? spec.shell : process.platform === "win32",
      });
      if (useStdin && child.stdin.writable) { child.stdin.write(prompt + "\n"); child.stdin.end(); }
    } catch (e) { reject(new Error(`spawn ${spec.bin} failed: ${e.message}`)); return; }
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000).unref();
    }, timeoutSec * 1000);
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`${spec.bin} not found or failed to start: ${e.message}`)); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const parsed = spec.parse(stdout);
      resolve({
        engine, ok: !timedOut && (code === 0 || code === null), exit_code: code, signal: signal || null, timed_out: timedOut,
        cwd: existsSync(cwd) ? path.resolve(cwd) : "(cwd missing)", prompt_chars: prompt.length, ...parsed,
        stderr_head: stderr.trim().slice(0, 800) || null,
        stderr_tail: stderr.trim().slice(-500) || null,
      });
    });
  });
}

/* ---------- MCP plumbing ---------- */

const serverInfo = { name: "cli-mcp", version: "1.0.0", engine_count: Object.keys(ENGINES).length };
const tools = [
  {
    name: `${PREFIX}ask`,
    description: "Run a headless coding-agent CLI and return its final text answer. Engines: " + Object.keys(ENGINES).join(", ") + ". A 401 in stderr_tail means that engine needs re-authentication.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The full task/prompt" },
        engine: { type: "string", enum: Object.keys(ENGINES), description: "Which CLI to run" },
        cwd: { type: "string", description: "Working directory" },
        timeoutSec: { type: "number", description: `Max seconds (default ${DEFAULT_TIMEOUT_SEC})` },
        tools: { description: "Allowed tool names (e.g. \"Read,Bash\")", anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        model: { type: "string", description: "Model override" },
        maxTurns: { type: "number", description: "claude --max-turns" },
        fullAuto: { type: "boolean", description: "codex --full-auto" },
      },
      required: ["prompt", "engine"],
    },
  },
  {
    name: `${PREFIX}doctor`,
    description: "Probe each engine CLI: found? version? quick minimal run?",
    inputSchema: { type: "object", properties: { engines: { type: "array", items: { type: "string" }, description: "Subset; default all" } } },
  },
];

function rpcOk(id, result) { return JSON.stringify({ jsonrpc: "2.0", id, result }); }
function rpcErr(id, code, message, data) { return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }); }

async function handle(request) {
  const { id, method, params } = request;
  switch (method) {
    case "initialize":
      return rpcOk(id, { protocolVersion: params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo });
    case "notifications/initialized": return null;
    case "ping": return rpcOk(id, {});
    case "tools/list": return rpcOk(id, { tools });
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name === `${PREFIX}ask`) {
        const r = await runEngine(args.engine, args.prompt, args);
        return rpcOk(id, { content: [{ type: "text", text: JSON.stringify({ answer: r.answer, ok: r.ok, engine: r.engine, timed_out: r.timed_out, meta: r.meta ?? null, stderr_head: r.stderr_head ?? null, stderr_tail: r.stderr_tail, cwd: r.cwd }, null, 2) }], isError: !r.ok || r.timed_out });
      }
      if (name === `${PREFIX}doctor`) {
        const list = (args.engines || Object.keys(ENGINES)).map(async (eng) => {
          if (!ENGINES[eng]) return { engine: eng, found: false, note: "unknown engine" };
          const r = await runEngine(eng, "Reply with OK.", { timeoutSec: 20 });
          return { engine: eng, found: !/not found/i.test(r.answer || "") && !/not found/i.test(r.stderr_tail || "") && r.ok !== undefined, ok: r.ok, timed_out: r.timed_out, sample: (r.answer || "").slice(0, 80), stderr_tail: r.stderr_tail };
        });
        const rows = await Promise.all(list);
        return rpcOk(id, { content: [{ type: "text", text: JSON.stringify({ engine_count: serverInfo.engine_count, rows }, null, 2) }], isError: false });
      }
      return rpcErr(id, -32601, `unknown tool ${name}`);
    }
    default:
      if (id === undefined || id === null) return null;
      return rpcErr(id, -32601, `method not found: ${method}`);
  }
}

function log(...a) { process.stderr.write("[cli-mcp] " + a.join(" ") + "\n"); }
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { log("bad json:", line.slice(0, 200)); continue; }
    log("recv:", req.method || "(no method)");
    let result;
    try { result = await handle(req); } catch (e) { log("handle error:", e.message); result = req.id !== undefined ? rpcErr(req.id, -32603, `handler error: ${e.message}`) : null; }
    if (result !== null) process.stdout.write(result + "\n");
    else if (req.id !== undefined && req.method !== "notifications/initialized") process.stdout.write(rpcErr(req.id, -32600, "ignored notification-like request") + "\n");
  }
});
process.stdin.on("end", () => { log("stdin closed, exiting"); process.exit(0); });
log("cli-mcp ready, engines:", Object.keys(ENGINES).join(","), "prefix:", PREFIX, "cwd:", DEFAULT_CWD);
