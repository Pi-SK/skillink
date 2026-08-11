# NEXT_STEPS.md — 交接清单（2026-08-11）

> 本文件是 Skill Mana v0.10 升级中途的交接文档。接手者先读本文件 + HANDOFF.md，再读代码。
> 所有改动已通过 cargo test（15/15）和 pnpm build（tsc + vite），待 git 提交。

## 当前状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | git init + .gitignore + 版本统一 0.10.0 | ✅ 已提交 |
| M1 | UI 地基（token/图标/开关/toast/确认弹窗/导航壳）+ 技能矩阵翻新 + 插件卡片 + 导入 UX（原生对话框+真实拖拽） | ✅ |
| M2 | 指令文档管理全形态：Rust 命令 + 三栏 UI + CodeMirror + 自动备份/恢复 + 共享片段分发同步 | ✅ |
| M3 | 反向发现 + 体检 + 详情抽屉 | ✅ |
| M4 | 完整扫描 + adopt 纳管 + 主题 v3 深浅双色系 + npx skills 渠道 + Windows-only 定位 | ✅ |

## M4 实现内容

1. **扫描完整性补全**：`collect_unmanaged_plugin_skills` 补扫未纳管插件内嵌 skill（此前 marketplace 插件的 skill 完全不可见）；`collect_unmanaged_in` 要求 SKILL.md 才算 skill 资产，顺带解析描述。
2. **纳管机制**：`sync::adopt()` 支持 copy/move 两种模式；`adopt_skill`/`adopt_plugin` 命令 + lib.rs 注册；前端 SkillsPage/PluginsPage 未纳管行显式「纳管」按钮 + ConfirmDialog（含 mode 单选）；types/api/mock 同步扩展。
3. **npx skills 渠道**：`npx skills add -g` 安装到 `~/.agents/skills`（已覆盖）；per-agent 安装无 -g 落入各 Agent 目录（反向发现覆盖）。
4. **主题 v3**：默认石墨黑 + 靛紫深色主题，`[data-theme="light"]` 30+ token 浅色覆盖；顶栏 Sun/Moon 切换 + localStorage 持久化；所有硬编码 hex/rgba 已 token 化。
5. **Windows-only**：当前仅支持 NTFS junction，macOS/Linux symlink 标记为后续方向。

## 关键架构速查（更新）

- `sync::adopt(origin, dest, mode, backup_root)` → mode="move" 时复制后原位置替换为 junction，真实目录先备份到 `~/.skillman/backups/adopted/`（跨盘回退 copy+remove_dir_all）。
- 未纳管 plugin 内嵌 skill 的 `source` 字段为 plugin 名（非"独立"），UI 据此显示"插件内嵌"标签。
- `UnmanagedItem` 新增 `description` 和 `source` 字段（types.ts + Rust commands.rs + mock.ts 同步）。
- 主题 token 新增：`--border-strong` / `--neutral-tint` / `--overlay` / `--knob` / `--knob-on` / `--switch-off` / `--skeleton-hi` / `--group-hover` / `--purple` / `--purple-tint` / `--accent-border` / `--yellow-border` / `--yellow-strong` / `--text-on-accent` / `--text-inverse` / `--red-hover`。

## 验证结果

- `cargo test`：15 passed / 0 failed（含 3 个新 adopt 单元测试）
- `pnpm build`：tsc + vite 编译通过

## 后续方向

- macOS/Linux symlink 适配
- Plugin marketplace 注册表自动发现
- VSIX Extension 同步支持
