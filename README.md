# 引擎路由（Engine Routing）— clone 即搭模板

把多个 coding-agent CLI（claude / codex / codebuddy / qwen / agy）通过本地 `cli-mcp` 桥接成 MCP 工具，按需派单给不同引擎，并按任务难度切换 codex 模型。

> 本仓库是一套**可复用模板**：clone 下来 → 按 §2 装各家 CLI → 按 §3 配 MCP 连接 → 按 §4 冒烟验证 → 按 §5 派单。
> 桥本体：`cli-mcp/index.template.mjs`（无依赖 Node stdio MCP server，所有本机路径/密钥已抽成 `<占位符>`，clone 后替换即可）。

## 0. 快速开始（TL;DR）

```powershell
# 1. clone
git clone https://github.com/hanghangworker-ui/engine-routing.git
cd engine-routing

# 2. 把模板桥复制出来并改成你自己的（替换所有 <占位符>）
copy cli-mcp\index.template.mjs cli-mcp\index.mjs
notepad cli-mcp\index.mjs        # 替换 <YOUR-...> 占位符，见 §2.4

# 3. 语法自检
node --check cli-mcp\index.mjs

# 4. 装好各家 CLI（§2）+ 配好 MCP 连接（§3）

# 5. 冒烟（§4）
```

## 1. 引擎与路由准则

| 任务类型 | 引擎 | 模型 | 说明 |
|---|---|---|---|
| 快速问答、小修、注释、单行 bug、跑命令 | **qwen** | qwen3.8-flash（免费默认） | 最快，几秒出 |
| 复杂问题（比 flash 难一档） | **qwen** | qwen3.8-2.4t-a95b（免费） | 传 `model:"qwen3.8-2.4t-a95b"` |
| 国内落地、中文项目、收尾验证、成品交付 | **codebuddy** | 本机默认 | 中文生态稳 |
| 架构梳理、复杂 bug、跨文件重构 | **codex** | 默认 gpt-6.1-sol | 主力重活 |
| 最难的活：疑难根因、关键设计决策、大跨度重构、6.1-sol 跑歪升级 | **codex + Astra** | gpt-6-astra | 1M context 旗舰，烧额度极快，切换前报备 |
| 最高难度决策、终审复核 | **claude** | 本机默认（sonnet/opus） | 走你的代理 |
| gemini 系交叉验证 | **agy** | — | 地域受限时暂不可用 |

> **qwen 免费/付费约束**：默认只用免费白名单（`qwen3.8-flash` + `qwen3.8-2.4t-a95b`）。付费模型（`qwen3.8-max`、`kimi-k3`、`glm-5.3`、`deepseek-*`）**调用前必须先向用户请求授权**，桥层拦截门会自动拒绝非白名单 model。`qwen-audio-3.1-tts-plus` 是 TTS 音频模型，文本端点拒收，文本场景不可用。

### 组合打法
- **大活**：codex（6.1-sol / Astra）出架构 → claude 复核 → codebuddy 落地 → qwen/agy 交叉验证
- **小活**：qwen 直接干
- **国内项目**：codebuddy 主刀

### codex 模型切换
- 不传 `model` → CLI 默认 gpt-6.1-sol
- 派单时传 `model:"gpt-6-astra"` → 旗舰模型（1M context，能力最强，额度窗口内消耗最快）
- 决策准则：任务够难 / 前次 6.1-sol 跑歪 → 升级 Astra；日常一律 6.1-sol

## 2. 安装各家 CLI + 配 token/代理

每个引擎对应一个独立 CLI，**先各自装好并配好凭据**，桥才会通。

| 引擎 | 安装 | 凭据/配置 | 备注 |
|---|---|---|---|
| claude | `npm i -g @anthropic-ai/claude-code`（或你的代理渠道 CLI） | `ANTHROPIC_API_KEY` 或代理账户（如 clodex.cc） | 走代理时确认余额 |
| codex | `npm i -g @openai/codex` | `OPENAI_API_KEY` / 订阅 | 需网络可达 OpenAI；可走代理 |
| codebuddy | `npm i -g @tencent-ai/codebuddy` | 本机默认账号 | 腾讯系，中文稳 |
| qwen | `npm i -g @qwen-code/qwen-code` | `QWENCLOUD_API_KEY`（写进 `~/.qwen/settings.json`） | 默认走 QwenCloud 中国端点 |
| agy | 你的 agy 二进制路径 | 你的 token | 地域受限时不可用 |

> 装完用 `claude --version` / `codex --version` / `codebuddy --version` / `qwen --version` 确认在 PATH。
> 若 npm 全局目录自设（非默认 `AppData\Roaming\npm`），记下该目录绝对路径，桥里要显式写进 `WIN_PATH_ADDITIONS`（见 §2.4）。

### 2.4 替换桥模板占位符
打开 `cli-mcp/index.mjs`（§0 复制出来的），替换所有 `<占位符>`：

- `WIN_PATH_ADDITIONS` 里的 `<YOUR-NPM-GLOBAL-BIN-DIR>`、`<YOUR-CODEX-BIN-DIR>` → 你本机的 npm 全局 bin / codex bin 绝对路径
- qwen spec：`<QWEN_CODE_PACKAGE_DIR>`（**正斜杠**，如 `D:/npm-global/node_modules/@qwen-code/qwen-code`）、`<QWEN_HOME_DIR>`（**正斜杠**，如 `C:/Users/HUAWEI/.qwen`）
- agy spec：`<AGY_EXE_PATH>` → 你的 agy.exe 绝对路径
- 代理：若你的 OpenAI/codex/claude 需走代理，把注释掉的 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 三行取消注释并填 `http://<你的代理>`

## 3. 配置 MCP 连接（stdio 型）

每个引擎 = 一条 stdio MCP 连接，**共用同一个 `index.mjs`**，靠环境变量 `DSH_CLI_MCP_TOOLS` 前缀区分工具名。在你用的 DSH/宿主里逐个配置：

| 连接名 | 前缀 | 工具名 | 引擎 | envJson |
|---|---|---|---|---|
| json-codebuddy | `buddy_` | `buddy_ask`/`buddy_doctor` | codebuddy | `DSH_CLI_MCP_TOOLS=buddy_` |
| json-codex | `codex_` | `codex_ask`/`codex_doctor` | codex | `DSH_CLI_MCP_TOOLS=codex_` |
| json-claude-code | `cc_` | `cc_ask`/`cc_doctor` | claude | `DSH_CLI_MCP_TOOLS=cc_` |
| custom-qwen | `qwen_` | `qwen_ask`/`qwen_doctor` | qwen | `DSH_CLI_MCP_TOOLS=qwen_` |
| custom-agy | `agy_` | `agy_ask`/`agy_doctor` | agy | `DSH_CLI_MCP_TOOLS=agy_` |

每连接统一参数（以 qwen 为例，其余把 `qwen_` 换成对应前缀）：

```jsonc
{
  "name": "qwen", "serverName": "qwen", "transport": "stdio",
  "command": "node",
  "args": ["<你仓库里>\\cli-mcp\\index.mjs"],
  "envJson": "{\"DSH_CLI_MCP_TOOLS\":\"qwen_\",\"DSH_CLI_MCP_CWD\":\"<你的工作目录>\"}"
}
```

> `args` 必须是 `index.mjs` 的绝对路径，漏传会导致裸 node 起不来。

## 4. 冒烟验证

```
mcp__qwen__qwen_ask(engine="qwen", prompt="Reply with exactly: QWEN_BRIDGE_OK")
mcp__codex__codex_ask(engine="codex", prompt="Reply with exactly: CODX_OK")
mcp__codex__codex_ask(engine="codex", prompt="Reply with exactly: ASTRA_OK", model="gpt-6-astra")
mcp__codebuddy__buddy_ask(engine="codebuddy", prompt="Reply with exactly: BUDDY_OK")
mcp__claude-code__cc_ask(engine="claude", prompt="Reply with exactly: CLAUDE_OK")
```

返回 `ok:true` + 非空纯文本 `answer` 即通道正常。`stderr_tail` 里的 502 / rmcp 噪音不影响结果，可忽略。

## 5. 各引擎 spec 实际代码片段

下面是 `index.mjs` 里各 spec 的关键片段（模板中已内置，这里便于对照理解）。

### claude
```js
claude: {
  bin: "claude",
  args: (p, o) => [
    "-p", p, "--output-format", "json",
    ...(o.model ? ["--model", o.model] : []),
    ...(o.maxTurns ? ["--max-turns", String(o.maxTurns)] : []),
  ],
  parse: /* 单 JSON，答案在 .result */
}
```

### codex（stdin 模式 + model 切换）
```js
codex: {
  bin: "codex", stdio: "stdin",
  args: (p, o) => ["exec", ...(o.fullAuto?["--full-auto"]:[]),
    ...(o.model ? ["--model", o.model] : []),   // 默认 6.1-sol；难活传 gpt-6-astra
    "--skip-git-repo-check", "--json"],
  parse: /* JSONL 事件流，末行 agent_message 即答案 */
}
// env 注入 CODEX_DISABLE_SANDBOX=1 绕过 .codex 目录 ACL 限制
```

### codebuddy
```js
codebuddy: {
  bin: "codebuddy",
  args: (p, o) => ["-p", p, "--output-format", "json", ...],
  parse: /* JSONL 尾扫取最后 type==="result" 的 .result */
}
```

### qwen（坑最多，务必按模板）
```js
qwen: {
  bin: "node", stdio: "ignore",
  cwd: "<QWEN_CODE_PACKAGE_DIR>",                       // 正斜杠
  shell: false,                                          // 关键：避免 cmd.exe 拼 argv 破坏 isMain
  args: (p, o) => [`<QWEN_CODE_PACKAGE_DIR>/cli.js`,
    "--prompt", q(p), "--output-format", "json",
    ...(o.model?["--model",o.model]:[])],
  extraEnv() { /* QWENCLOUD_API_KEY + QWEN_CODE_NO_RELAUNCH=true + QWEN_HOME(正斜杠) */ }
}
```
**关键坑**（已内置进模板）：
- entry 路径必须**正斜杠**（Windows 单反斜杠会被 C 转义层破坏：`\\n`→换行、`\\@`/`\\o` 吞字符）
- 必须 `shell:false`（shell:true 让 cmd.exe 拼 argv，破坏 `isMain` 判定 → 静默 exit 0 无输出）
- 非交互 prompt 只认 `--prompt/-p` 值 flag（positional query 不映射到 question）

### agy
```js
agy: { bin: "<AGY_EXE_PATH>", stdio: "ignore",
  args: (p,o) => ["-p", q(p), "--output-format", "json", ...(o.model?["--model",o.model]:[])] }
// 地域受限时不可用；连接可能被宿主丢弃需重建
```

## 6. 终端命令速查

```powershell
# --- 桥语法自检 ---
node --check cli-mcp\index.mjs

# --- 单独跑 qwen 直连（不经过桥，验证 CLI 本身通） ---
node <QWEN_CODE_PACKAGE_DIR>/cli.js --prompt "hi" --output-format json

# --- 手动喂一条 MCP 请求给桥（调试 tools/list） ---
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node cli-mcp\index.mjs

# --- 重置各家 CLI 登录态（401/Not logged in 时） ---
codex login          # 或重填 OPENAI_API_KEY
claude               # 重新走一遍认证

# --- git 推送本模板到远端 ---
git add -A && git commit -m "docs: 引擎路由 clone 即搭模板"
git push -u origin main
```

## 7. 常见问题排查（症状 → 原因 → 修复）

| 症状 | 原因 | 修复 |
|---|---|---|
| `qwen_ask` 返回空答案 / exit 0 无输出 | ① entry 用了单反斜杠 ② shell:true 破坏 isMain ③ prompt 用了 positional 而非 `--prompt` | 路径改正斜杠 + spec 设 `shell:false` + 用 `--prompt`（模板已内置） |
| `MODULE_NOT_FOUND`（qwen 的 chunk） | spawn 的 cwd 不在 qwen 包目录 | spec `cwd` 指向 `@qwen-code/qwen-code` 包目录 |
| `codex_ask` 网络失败 / 超时 | OpenAI 端点不可达 | 桥 env 注入 `HTTP/HTTPS/ALL_PROXY`；确认 Clash 节点在线 |
| `codex` 沙箱报错 | `.codex` 各目录 ACL 只给 RX | 桥 env `CODEX_DISABLE_SANDBOX=1`（模板已内置） |
| 某引擎 `401 / Not logged in`（stderr_tail） | 该 CLI 登录态过期 | 单独跑该 CLI 重新登录（§6），或确认代理/账户余额 |
| claude 返回欠费 | 代理账户（clodex.cc）余额不足 | 充值后重跑冒烟；以登录后台看到的余额为准 |
| MCP 连接建了但工具没出现 | `args` 漏传 `index.mjs` 绝对路径（裸 node 起不来） | 补 `args: ["<绝对路径>\\cli-mcp\\index.mjs"]` 后 reconnect |
| 桥里某 CLI "command not found" | npm 全局 bin 不在宿主 PATH 快照 | `WIN_PATH_ADDITIONS` 里加该 bin 目录绝对路径 |
| 改了 index.mjs 不生效 | 改完没重连 | `node --check` → `mcp_connector_reconnect(key)` → 冒烟 |
| 编辑桥代码后路径全乱（多重 `\\`） | write/edit 对含反斜杠代码会双重转义 | 用 node 行级脚本改，路径写正斜杠 + ASCII 边界校验；改完读回验证 |
| 沙箱里 `git push` 卡认证 / EPERM | 宿主沙箱禁 spawn remote-https / 非 tty 弹不了 GCM 框 | 在你**本地** PowerShell 推（用户名填账户，密码栏填 classic PAT，勾 `repo` scope） |

## 8. 已知坑与教训（浓缩）

- **Windows spawn 的 .js 入口路径须正斜杠**（单反斜杠被 C 转义层破坏）
- **MCP 工具 outputSchema 过滤**：未声明字段（如 `stderr_head`）会被丢，诊断字段须拼进 content JSON 文本
- **宿主沙箱禁 create process**：宿主直接 spawn 任何 exe 报 EPERM，一切引擎调用必须走 MCP 桥
- **npm 全局目录可自设**，宿主 PATH 快照未必含 → 桥 spec 用绝对路径 bin
- **codex .codex 目录 ACL 只 RX** → `CODEX_DISABLE_SANDBOX=1` 绕过
- **ag y 连接可能被宿主丢弃** → 需 `mcp_connector_configure` 重建

---
配套文件：`cli-mcp/index.template.mjs`（桥本体模板）、`SKILL.md`（可触发技能，路由+冒烟固化）。
