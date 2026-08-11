# NEXT_STEPS.md — 交接清单（2026-08-11）

> 本文件是 Skill Mana v0.9 升级中途的交接文档。接手者先读本文件 + HANDOFF.md，再读代码。
> 所有 M1/M2/M3 改动均**尚未 git 提交**（仓库只有基线提交 `8379081`），接手后第一步先提交。

## 当前状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | git init + .gitignore + 版本统一 0.9.0 | ✅ 已提交 |
| M1 | UI 地基（token/图标/开关/toast/确认弹窗/导航壳）+ 技能矩阵翻新 + 插件卡片 + 导入 UX（原生对话框+真实拖拽） | ✅ 代码完成，浏览器 mock 验证过 |
| M2 | 指令文档管理全形态：Rust 命令 + 三栏 UI + CodeMirror + 自动备份/恢复 + 共享片段分发同步（受管标记块） | ✅ 代码完成，Rust 12 测试全过，浏览器验证过 |
| M3 | 反向发现 + 体检 + 详情抽屉 | 🔶 一半：Rust 命令已完成；前端集成了抽屉和体检 chip，**未纳管分组展示、插件页未纳管、设置页体检面板、相关 CSS、最终验证/提交未完成** |

## 剩余待办（按序）

1. **git 提交当前工作**（第一批 commit，可分 M1/M2/M3 三个 commit）
2. **M3 前端收尾**：
   - SkillsPage：矩阵底部加「本地未纳管」折叠分组（按 agent 分组，行样式：虚线边框 + tag-local 徽标，只读）
   - PluginsPage：卡片网格下方加未纳管插件展示（复用 unmanaged 数据，`kind === "plugin"`）
   - SettingsPage：加「健康检查」section，列出 `getIssues()` 结果（conflict/drift/broken_link 三类，图标区分）
   - CSS 缺失项：`.drawer-overlay`/`.drawer`（右侧滑入 420px）、`.drawer-body/.drawer-head/.drawer-footer`、`.drawer-skill-title`、`.skill-drawer-meta/.meta-row/.meta-label`、`.skill-drawer-section/.section-label`、`.skill-md-box`、`.drawer-agent-rows`、`.issue-chip`、`.m-row.clickable`（hover 提示 cursor）、`.spin` 动画、`unmanaged` 行样式
3. **验证**：`cargo test --lib`（12 测试）+ `corepack pnpm build` + `corepack pnpm dev` 浏览器走查（mock 模式，非 Tauri）
4. **HANDOFF.md 更新**：补 v0.9 架构（instructions.rs 模块、docs 命令清单、设计系统 v2、CodeMirror 按需加载）
5. **M4 方向**（已批准但未排期）：批量操作（同步到全部 Agent）、应用内 Agent 管理 UI、macOS/Linux symlink、全文搜索

## 关键架构速查

- 前端入口 `src/App.tsx`（壳层）→ `src/store.tsx`（DataProvider：快照+增量 toggle）→ `src/pages/*`；`src/components/*` 共享组件；`src/mock.ts` 浏览器预览降级（`isTauri` 检测）
- Rust 模块：`registry.rs`（Agent 注册表）、`scanner.rs`（SKILL.md 扫描）、`sync.rs`（junction 创建/删除，有单元测试）、`instructions.rs`（指令文档+备份+片段+同步引擎，8 个单元测试）、`commands.rs`（全部 Tauri 命令）
- 指令文档注册表在 `instructions.rs::doc_specs()`：claude→CLAUDE.md，codex→AGENTS.md，qwenworkcn/qoderworkcn→awareness/main/{AGENTS,SOUL,USER,MEMORY}.md（MEMORY 只读）
- 片段分发：`~/.skillman/snippets/<id>.md`（frontmatter name:），目标文档内写 `<!-- SKILLMAN:SYNC <id> -->...<!-- SKILLMAN:END -->` 受管块；写盘前自动备份到 `~/.skillman/backups/<agent>/`（保留 20 份）；删除片段移入 `~/.skillman/.trash/`
- 命令注册：`lib.rs` invoke_handler；新命令两个地方都要加（commands.rs 定义 + lib.rs 注册）
- 未纳管判断：junction 目标不以 `~/.agents/skills` 或 `~/.agents/plugins` 开头即未纳管；plugins-custom 的兄弟目录 `plugins/`（marketplace）也扫描，需 `looks_like_plugin` 过滤（有 .claude-plugin/.qoder-plugin/commands/agents/skills/hooks 之一才算）

## 踩坑速查（新增于 v0.9）

- 前端命令参数：Tauri 2 自动把 camelCase 参数名转 snake_case，前端 invoke 时传 `agentKey` 等 camelCase 即可
- `SyncTarget` 需要 `Deserialize`（入参），其余返回结构只要 `Serialize`
- CodeMirror 依赖较重，DocsPage 用 `React.lazy` 按需加载，**不要再静态 import**
- `marked` 配置 `{ gfm: true, breaks: true }`，渲染前必须 `DOMPurify.sanitize`
- 浏览器 mock 模式下文档读写走 `mock.ts` 的内存 Map，片段/备份/同步命令仅 Tauri 可用（UI 已做 isTauri 守卫）
- tauri.conf.json 窗口已加 minWidth/minHeight；构建 exe 需 icon 含 .ico（见 HANDOFF 坑 1）
- 路径一律经 `registry::expand_tilde`（"~/..."），不要拼接绝对路径；备份名/片段 id 均有严格校验防路径注入
