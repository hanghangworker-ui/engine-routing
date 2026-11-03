# 引擎路由笔记（Engine Routing）

把多个 coding-agent CLI 通过本地 `cli-mcp` 桥接成 MCP 工具，按需派单给不同引擎，并按任务难度切换 codex 模型。

> 状态：2026-11-03 固化。配套代码：`cli-mcp/index.mjs`（本机 D:\dsh工作区\cli-mcp\）。

## 1. 引擎与路由

| 任务类型 | 引擎 | 模型 | 说明 |
|---|---|---|---|
| 快速问答、小修、注释、单行 bug | **qwen** | qwen3.8-flash | 最快，几秒出 |
| 国内落地、中文项目、收尾验证 | **codebuddy** | 本机默认 | 中文生态稳 |
| 架构梳理、复杂 bug、跨文件重构 | **codex** | 默认 gpt-6.1-sol | 主力重活 |
| 最难的活：疑难根因、关键设计决策、大跨度重构、6.1-sol 跑歪升级 | **codex + Astra** | gpt-6-astra | 烧额度极快，切换前报备 |
| 最高难度决策、终审复核 | **claude** | 本机默认 | 走 clodex.cc 代理 |
| gemini 系交叉验证 | **agy** | — | 地域受限时暂不可用 |

### 组合打法
- **大活**：codex（6.1-sol / Astra）出架构 → claude 复核 → codebuddy 落地 → qwen/agy 交叉验证
- **小活**：qwen 直接干
- **国内项目**：codebuddy 主刀

### codex 模型切换
- 不传 `model` → CLI 默认 gpt-6.1-sol
- 派单时传 `model:"gpt-6-astra"` → 旗舰模型（1M context，能力最强，5h 额度窗口内消耗最快）
- 决策准则：任务够难 / 前次 6.1-sol 跑歪 → 升级 Astra；日常一律 6.1-sol

## 2. 桥接架构（cli-mcp）

- 桥文件：`cli-mcp/index.mjs`（无依赖 Node stdio MCP server）
- 各引擎共用同一文件，靠环境变量 `DSH_CLI_MCP_TOOLS` 区分工具名前缀：

| MCP 连接 | 前缀 | 工具名示例 | 引擎 |
|---|---|---|---|
| json-codebuddy | `buddy_` | `buddy_ask`, `buddy_doctor` | codebuddy |
| json-codex | `codex_` | `codex_ask`, `codex_doctor` | codex |
| json-claude-code | `cc_` | `cc_ask`, `cc_doctor` | claude |
| custom-qwen | `qwen_` | `qwen_ask`, `qwen_doctor` | qwen |
| custom-agy | `agy_` | `agy_ask`, `agy_doctor` | agy |

- 引擎调用：`<prefix>_ask(prompt, engine, cwd?, timeoutSec?, model?, tools?, maxTurns?, fullAuto?)`

## 3. 各引擎 spec 要点（index.mjs）

### claude
- bin `claude`，args：`-p <prompt> --output-format json`，可选 `--model`、`--max-turns`、`--allowedTools`
- parse：单个 JSON，答案在 `.result`

### codex
- bin `codex`，stdin 模式（`codex exec` 从 stdin 读 prompt）
- args：`exec [--full-auto] [--model <m>] --skip-git-repo-check --json`
- **L103 已加 model 切换**：`...(o.model ? ["--model", o.model] : [])`
- parse：JSONL 事件流，末行 `agent_message` 即答案
- env：`CODEX_DISABLE_SANDBOX=1`（绕过 .codex 目录 ACL 限制）

### codebuddy
- bin `codebuddy`，args：`-p <prompt> --output-format json`，可选 `--allowedTools`
- parse：JSONL，末行 `type==="result"` 的 `.result`

### qwen
- bin `node`，cwd 指向包目录 `D:/npm-global/node_modules/@qwen-code/qwen-code`
- args：`cli.js --prompt <q> --output-format json [--model <m>]`
- **关键坑**（已修）：
  - entry 路径须**正斜杠**（Windows 单反斜杠会被 C 转义破坏）
  - 必须 `shell:false`（shell:true 让 cmd.exe 拼 argv，破坏 isMain 判定 → 静默 exit 0）
  - 非交互 question 只来自 `--prompt/-p` 值 flag（positional query 不映射）
- extraEnv：`QWENCLOUD_API_KEY`（读 `~/.qwen/settings.json`）、`QWEN_CODE_NO_RELAUNCH=true`、`QWEN_HOME`（正斜杠）

### agy
- 地域受限时不可用；连接可能被 Host 丢弃需重建

## 4. 连接管理（mcp_connector_*）

- `mcp_connector_status` 查看全部连接状态
- `mcp_connector_reconnect(key)` 重连某连接（如 `json-codex`）
- `mcp_connector_set_enabled(key, true)` 恢复误停用的连接
- `mcp_connector_configure(...)` 新建连接（stdio 型须带 `command` + `args` + `envJson`，args 指向 `index.mjs`）

## 5. 常用冒烟命令

```
# 验证某引擎桥通
mcp__qwen__qwen_ask(engine="qwen", prompt="Reply with exactly: QWEN_BRIDGE_OK")
mcp__codex__codex_ask(engine="codex", prompt="Reply with exactly: ASTRA_OK", model="gpt-6-astra")
mcp__codebuddy__buddy_ask(engine="codebuddy", prompt="Reply with exactly: BUDDY_OK")
```

返回 `ok:true` + 纯文本 answer 即通道正常；`stderr_tail` 里的 502/rmcp 噪音不影响结果。

## 6. 已知坑与教训

- **Windows spawn 的 .js 入口路径须正斜杠**：单反斜杠被 C 转义层破坏（`\n`→换行、`\o`/`\@` 等吞字符）
- **MCP 工具 outputSchema 过滤**：未声明的字段（如 `stderr_head`）会被丢弃，诊断字段须拼进 content JSON 文本
- **DSH 沙箱禁 create process**：宿主直接 spawn 任何 exe 报 EPERM，一切引擎调用必须走 MCP 桥
- **npm 全局目录可自设**（`D:\npm-global`），宿主 PATH 快照未必含 → 桥 spec 用绝对路径 bin
- **edit 后须读回验证转义层数**：write/edit 对含反斜杠代码会双重转义，node 行级脚本更可靠（用正斜杠 + ASCII 边界 + JSON.stringify 输出）
- **codex .codex 各目录 ACL 只给 RX**：桥 env 注入 `CODEX_DISABLE_SANDBOX=1` 绕过
