# CHANGELOG

本文件记录 `engine-routing` 模板仓库的每次改动，方便版本回退。

> 回退方法：`git log --oneline` 找到目标 commit，`git reset --hard <sha>` 或 `git revert <sha>`。
> 每条记录标注：**改了哪些文件 / 改动内容 / 回退方式**。

---

## 2026-11-03

### ccd8184 — 模板 e.g. 示例路径替换为本机 HUAWEI 实际路径
- **文件**：`cli-mcp/index.template.mjs`、`README.md`
- **内容**：模板里 5 处 `<you>` 占位的 e.g. 示例路径替换为实际 `HUAWEI` 值（npm 全局目录、Codex bin、qwen home、agy.exe 示例路径），**保留 `<YOUR-*>` / `<QWEN_*_DIR>` / `<AGY_EXE_PATH>` 尖括号占位符 token 不变**（那是 clone 后由使用者替换的机制，非示例值）
- **回退**：`git revert ccd8184` 或 `git reset --hard 125a223`

### 125a223 — clone 链接改为 hanghangworker-ui
- **文件**：`README.md`、`SKILL.md`、`cli-mcp/index.template.mjs`
- **内容**：所有 GitHub clone URL 从占位 `your-username` 改为实际账号 `hanghangworker-ui`
- **回退**：`git reset --hard 7d2d8e3`

### 7d2d8e3 — 模板桥小修
- **文件**：`cli-mcp/index.template.mjs`
- **内容**：qwen spec 坑位补全（正斜杠 entry + `shell:false` + `--prompt` 显式传值 + `QWEN_CODE_NO_RELAUNCH=true` + `QWEN_HOME` 注入）；codex spec 加 `--model` 可选切换行
- **回退**：`git reset --hard a903476`

### a903476 — 升级为 clone 即搭模板
- **文件**：`cli-mcp/index.template.mjs`（新增 336 行）、`README.md`（重写为 217 行 8 节）、`SKILL.md`（新增）
- **内容**：把实填版 `index.mjs` 抽成占位符模板（`<YOUR-NPM-GLOBAL-BIN-DIR>` 等），补终端命令速查 + 常见问题排查章节
- **回退**：`git reset --hard 2d9b608`

### 2d9b608 — 初版
- **文件**：`README.md`（97 行）、`SKILL.md`（47 行）
- **内容**：首次提交引擎路由笔记
- **回退**：（初始 commit，无更早版本）

---

## 桥本机实填版（不入仓，仅本机）

> 以下改动发生在**本机** `cli-mcp/index.mjs`（由模板复制填占位符得到），**不进本仓库**。
> 记录于此仅为完整审计；仓库模板 `index.template.mjs` 同步了其中通用部分。

### qwen 免费白名单 + API key 读取修复（2026-11-03）
- **文件**：本机 `cli-mcp/index.mjs`
- **改动**：
  1. `readQwenApiKey()` 加 fallback 读 `settings.json` 的 `j.env.QWENCLOUD_API_KEY`（原只读顶层 `j.QWENCLOUD_API_KEY || j.apiKey`，拿不到值）
  2. qwen spec 默认 `--model qwen3.8-flash`，新增 `modelWhitelist` + `defaultModel` 字段
  3. qwen parse 重写：CLI stdout 实际是 **JSON 数组**（stream events），旧 parse 只处理单对象 → 新逻辑倒序找 `type=="result"` 条目取 `.result`
  4. ask 拦截门：`qwen_ask` 传非白名单 model 直接拒绝，提示"需用户授权"
- **实测**：`qwen3.8-flash` ✅ / `qwen3.8-2.4t-a95b` ✅ / `qwen-audio-3.1-tts-plus` ❌（TTS 端点拒收）
- **本机 settings.json**（`C:\Users\HUAWEI\.qwen\settings.json`，不入仓）：`modelProviders.openai[]` 从 7 → 9 条，注册 `qwen-audio-3.1-tts-plus` + `qwen3.8-2.4t-a95b`

### 路由准则 v2.1（本 commit 同步）
- **文件**：`SKILL.md`
- **改动**：路由表从 v2 简版升级 v2.1，加 qwen 免费模型细分 + 付费授权门 + audio 模型说明 + 组合打法
- **回退**：`git revert <this-commit>` 或 `git reset --hard ccd8184`
