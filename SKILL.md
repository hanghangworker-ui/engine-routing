---
name: cli-engine-routing
description: 通过本地 cli-mcp 桥把多个 coding-agent CLI（claude/codex/codebuddy/qwen/agy）接成 MCP 工具，并按任务难度路由派单、切换 codex 模型。
user-invocable: true
argument-hint: [engine]
---

# 引擎路由 Skill

## 何时用
- 用户要求「派个任务给 codex / qwen / claude / codebuddy / agy」「用哪个引擎」「让某 CLI 跑一下」
- 需要按任务复杂度选引擎 / 切 codex 模型

## 路由准则 v2.3（默认，2026-11-26 实测重订）

> 以本机实测为准：qwen 两档免费模型、codex `gpt-6.2-astra`、codebuddy `hy4flash-free`、claude 已接 DeepSeek、agy 走 agnes `auto`。五家均已冒烟通过。

| 任务 | 引擎 | 模型 | 备注 |
|---|---|---|---|
| 快速问答 / 小修 / 注释 / 跑命令出结果 | `qwen` | `qwen3.8-flash`（免费） | 最快，几秒出 |
| 复杂问题（比 flash 难一档） | `qwen` | `qwen3.8-2.4t-a95b`（免费） | 传 `model:"qwen3.8-2.4t-a95b"` |
| 国内落地 / 中文项目 / 成品交付 / 收尾验证 | `codebuddy` | `hy4flash-free`（本机默认） | 中文生态稳，免费 |
| 架构梳理 / 跨文件重构 / 一般复杂 bug | `codex` | `gpt-6.2-astra`（配置默认） | 经本机 free-llm 路由，reasoning=high |
| 大代码库 / 长上下文 / 疑难根因 | `claude` | `deepseek-flash[1m]` | DeepSeek 后端，1M context，effort=max |
| 最高难度决策 / 终审复核 / 天花板 | `claude` | `model:"claude-opus-4-6"` → `deepseek-v4-pro` | DeepSeek 把 `claude-opus-*` 映射为 V4 Pro；烧额度，切前报备 |
| gemini 系交叉验证 / 独立复核 | `agy` | `auto`（可选 gemini-4-hydrogen / gemini-3.8-flash） | 不同模型族，独立复核 |

### 组合打法
- **大活**：codex（`gpt-6.2-astra`）出架构 → claude（`deepseek-flash[1m]`）长上下文落地 → codebuddy 收尾验证 → agy 交叉验证
- **最难活**：claude 传 `model:"claude-opus-4-6"` 走 `deepseek-v4-pro` 终审
- **小活**：qwen flash 直接干
- **国内项目**：codebuddy 主刀
- **交叉验证**：交付前用 agy 独立复核；关键决策 / 疑难根因 / 验收建议跑，常规小活可省；两方分歧升级 claude（`deepseek-v4-pro`）终审

### 模型与路由现状（实测）
- **qwen**：桥只放行免费白名单 `qwen3.8-flash` + `qwen3.8-2.4t-a95b`（TTS 模型文本不可用）；付费模型须先向你请示。直跑 CLI（不经桥）会走 `~/.qwen/settings.json` 的 `agnes-3.0-flash`，与规则不一致。
- **codex**：`gpt-6.2-astra` 是本机 `~/.codex/config.toml` 默认值，`gpt-*` 经 free-llm 映射为 `auto`，实际后端由本机路由决定；桥注释里的 `gpt-6.1-sol` 已过时。
- **claude**：已重装 2.1.332 并接入 DeepSeek Anthropic 端点；默认 `deepseek-flash[1m]`，`claude-opus-*` → `deepseek-v4-pro`，`claude-sonnet-*`/`claude-haiku-*` → `deepseek-flash`。启动时的 `unrecognized_model` 警告属正常。
- **agy**：`model: auto`（agnes provider）；`agy models` 可列出 gemini-4-hydrogen(high/xhigh/medium/low)、gemini-3.8-flash(high/medium/low)、claude-sonnet-4-6、claude-opus-4-6-thinking、gpt-oss-120b-medium。

### qwen 免费/付费模型约束（重要）
- **免费白名单**（默认只用这些）：`qwen3.8-flash`（默认）+ `qwen3.8-2.4t-a95b`
- **付费模型**（`qwen3.8-max`、`kimi-k3`、`glm-5.3`、`deepseek-*` 等）**调用前必须先向用户请求授权**，不可自动使用
- 桥层已内置拦截门：`qwen_ask` 传非白名单 model 会被直接拒绝，提示需用户授权
- 注：`qwen-audio-3.1-tts-plus` 是 TTS 音频模型，文本 chat 端点拒收（400 url error），文本场景不可用

### codex 模型切换
- 不传 `model` → 本机 `~/.codex/config.toml` 默认 `gpt-6.2-astra`（经 free-llm 映射 auto）
- 按需传 `model:"<其他模型名>"` 覆盖；实际后端由本机 free-llm 路由决定
- 日常直接用默认即可；不再有 6.1-sol / Astra 的档位说法

## 派单动作
用对应 MCP 工具（前缀见下），`engine` 参数与工具前缀一致：

| 前缀 | 工具 | 引擎 |
|---|---|---|
| `qwen_` | `mcp__qwen__qwen_ask` | qwen |
| `buddy_` | `mcp__codebuddy__buddy_ask` | codebuddy |
| `codex_` | `mcp__codex__codex_ask` | codex |
| `cc_` | `mcp__claude-code__cc_ask` | claude |
| `agy_` | `mcp__agy__agy_ask` | agy |

- 覆盖模型：`codex_ask` 传 `model:"<模型名>"`；claude 走 V4 Pro 传 `model:"claude-opus-4-6"`
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
