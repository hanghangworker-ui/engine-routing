---
name: cli-engine-routing
description: 通过本地 cli-mcp 桥把多个 coding-agent CLI（claude/codex/codebuddy/qwen/agy）接成 MCP 工具，并按任务难度路由派单、切换 codex 模型。
user-invocable: true
argument-hint: [engine]
---

# 引擎路由 Skill

## 何时用
- 用户要求「派个任务给 codex / qwen / claude / codebuddy」「用哪个引擎」「让某 CLI 跑一下」
- 需要按任务复杂度选引擎 / 切 codex 模型

## 路由准则（默认）

| 任务 | 引擎 | 备注 |
|---|---|---|
| 快速问答 / 小修 / 注释 | `qwen` | 最快 |
| 国内落地 / 中文项目 / 收尾验证 | `codebuddy` | 中文生态稳 |
| 架构 / 复杂 bug / 跨文件重构 | `codex` | 默认 gpt-6.1-sol |
| 最难的活 / 6.1-sol 跑歪升级 | `codex` + `model:"gpt-6-astra"` | 切前报备，烧额度快 |
| 最高难度决策 / 终审复核 | `claude` | clodex.cc 代理 |
| gemini 系交叉验证 | `agy` | 地域受限时跳过 |

## 派单动作
用对应 MCP 工具（前缀见下），`engine` 参数与工具前缀一致：

| 前缀 | 工具 | 引擎 |
|---|---|---|
| `qwen_` | `mcp__qwen__qwen_ask` | qwen |
| `buddy_` | `mcp__codebuddy__buddy_ask` | codebuddy |
| `codex_` | `mcp__codex__codex_ask` | codex |
| `cc_` | `mcp__claude-code__cc_ask` | claude |
| `agy_` | `mcp__agy__agy_ask` | agy |

- 切 Astra：`codex_ask` 时传 `model:"gpt-6-astra"`
- 通用参数：`prompt`、`engine`、`cwd`、`timeoutSec`、`tools`、`fullAuto`

## 冒烟
```
<引擎>_ask(engine="<引擎>", prompt="Reply with exactly: <引擎>_OK")
```
返回 `ok:true` + 纯文本 answer 即正常；stderr 里 502/rmcp 噪音可忽略。

## 桥侧改动须
- 改 `cli-mcp/index.mjs` 后：`node --check index.mjs` → `mcp_connector_reconnect(key)` → 冒烟
- Windows 下 .js 入口路径一律正斜杠；qwen spec 须 `shell:false`
