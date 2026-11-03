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

## 路由准则 v2.1（默认）

| 任务 | 引擎 | 模型 | 备注 |
|---|---|---|---|
| 快速问答 / 小修 / 注释 / 跑命令出结果 | `qwen` | 默认 `qwen3.8-flash`（免费） | 最快，几秒出 |
| 复杂问题（比 flash 难一档） | `qwen` | `qwen3.8-2.4t-a95b`（免费） | 传 `model:"qwen3.8-2.4t-a95b"` |
| 国内落地 / 中文项目 / 成品交付 / 收尾验证 | `codebuddy` | 本机默认 | 中文生态稳 |
| 架构梳理 / 跨文件重构 / 一般复杂 bug | `codex` | 默认 gpt-6.1-sol（不传 model） | 主力重活 |
| 最难的活 / 疑难根因 / 6.1-sol 跑歪升级 | `codex` + `model:"gpt-6-astra"` | gpt-6-astra | 1M context 旗舰，烧额度极快，切前报备 |
| 最高难度决策 / 终审复核 / 天花板 | `claude` | 本机默认（sonnet/opus） | 走代理 |
| gemini 系交叉验证 | `agy` | — | 地域受限时跳过 |

### 组合打法
- **大活**：codex（6.1-sol 或 Astra）出架构 → qwen 快速执行 → codebuddy 收尾验证
- **小活**：qwen 直接干（flash 打穿）
- **国内项目**：codebuddy 主刀

### qwen 免费/付费模型约束（重要）
- **免费白名单**（默认只用这些）：`qwen3.8-flash`（默认）+ `qwen3.8-2.4t-a95b`
- **付费模型**（`qwen3.8-max`、`kimi-k3`、`glm-5.3`、`deepseek-*` 等）**调用前必须先向用户请求授权**，不可自动使用
- 桥层已内置拦截门：`qwen_ask` 传非白名单 model 会被直接拒绝，提示需用户授权
- 注：`qwen-audio-3.1-tts-plus` 是 TTS 音频模型，文本 chat 端点拒收（400 url error），文本场景不可用

### codex 模型切换
- 不传 `model` → CLI 默认 gpt-6.1-sol
- 派单时传 `model:"gpt-6-astra"` → 旗舰（1M context，能力最强，额度窗口内消耗最快）
- 决策准则：任务够难 / 前次 6.1-sol 跑歪 → 升级 Astra；日常一律 6.1-sol

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
- 通用参数：`prompt`、`engine`、`cwd`、`timeoutSec`、`tools`、`fullAuto`、`maxTurns`

## 冒烟
```
<引擎>_ask(engine="<引擎>", prompt="Reply with exactly: <引擎>_OK")
```
返回 `ok:true` + 非空纯文本 answer 即正常；stderr 里 502/rmcp 噪音可忽略。

## 桥侧改动须
- 改 `cli-mcp/index.mjs`（由 `cli-mcp/index.template.mjs` 复制并填占位符）后：`node --check index.mjs` → `mcp_connector_reconnect(key)` → 冒烟
- Windows 下 .js 入口路径一律正斜杠；qwen spec 须 `shell:false` 且用 `--prompt` 显式传值

## 快速排障（症状→修复）
- `qwen_ask` 空输出/exit0：路径改正斜杠 + `shell:false` + `--prompt`
- MCP 工具没出现：补 `args: ["<绝对路径>\\cli-mcp\\index.mjs"]` 后 reconnect
- CLI command not found：桥 `WIN_PATH_ADDITIONS` 加该 bin 目录
- 401/Not logged in：单独跑该 CLI 重新登录
- 详见 README §7「常见问题排查」
