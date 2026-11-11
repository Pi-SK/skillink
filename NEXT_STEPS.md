# NEXT_STEPS.md — 交接清单（2026-08-11）

> 历史开发记录：此处的版本、路径和完成状态反映记录时的情况，不代表当前状态。当前项目说明见 [README.md](README.md)。

> 本文件是 Skill Mana 升级中途的交接文档。接手者先读本文件 + HANDOFF.md，再读代码。
> 所有改动已通过 cargo test（16/16）和 pnpm build（tsc + vite），待 git 提交。

## 当前状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | git init + .gitignore + 版本统一 0.10.0 | ✅ 已提交 |
| M1 | UI 地基（token/图标/开关/toast/确认弹窗/导航壳）+ 技能矩阵翻新 + 插件卡片 + 导入 UX（原生对话框+真实拖拽） | ✅ |
| M2 | 指令文档管理全形态：Rust 命令 + 三栏 UI + CodeMirror + 自动备份/恢复 + 共享片段分发同步 | ✅ |
| M3 | 反向发现 + 体检 + 详情抽屉 | ✅ |
| M4 | 完整扫描 + adopt 纳管 + 主题 v3 深浅双色系 + npx skills 渠道 + Windows-only 定位 | ✅ |
| M5 | 多选删除 + 行头多选框 + 批量/一键纳管 + 版本与修改时间全覆盖 + 插件详情抽屉 + 平台官方 logo + 排版修复 | ✅ 待提交 |

## M5 实现内容（2026-08-11）

1. **删除机制**：`sync::move_to_trash`（移入 `~/.skillman/.trash/<类别>/<名>-<时间戳>`，绝不物理删除）；`delete_skill` / `delete_plugin` 命令先清理各 Agent 中指向源的 junction（含插件内嵌技能链接）再移入回收区；源本身是链接时拒删；前端多选删除 + danger 确认弹窗，copy 模式副本不受影响（弹窗已注明）。
2. **行头多选**：技能矩阵多选框列移到行首（30px sticky left:0，技能名 sticky left:30px），纳管行勾选=删除、未纳管行勾选=批量纳管，统一选择操作栏（删除/纳管/清除）；插件卡片头部增加勾选框。
3. **批量纳管**：技能页批量纳管改为弹窗选择 move/copy 模式；插件页未纳管区支持勾选批量 + 「一键全部纳管」。
4. **元信息全覆盖**：`UnmanagedItem` 与 `PluginInfo` 新增 `version` / `mtime_ms`（skill 取 SKILL.md frontmatter，plugin 取 plugin.json，缺 manifest 回退目录 mtime）；未纳管行版本/时间列不再显示占位符。
5. **插件详情**：`get_plugin_detail`（版本/描述/内嵌技能清单）+ `open_plugin_folder`；卡片标题点击打开 Drawer 展示。
6. **平台 logo**：`src/assets/logos/` 收录 7 平台官方 logo（claude/codex/qoder/qwenworkcn/qoderworkcn/trae/copilot；codex 着色 #10a37f、copilot 着色 #8b949e、qoderwork 旧版沿用 Qoder 标识）；`AgentIcon.tsx` 改 img 渲染，未链接态用 grayscale+opacity；表头 Agent 列加宽至 58px，logo 下显示平台短名。
7. **排版修复**：矩阵末尾新增 `minmax(0,1fr)` 填充列，窗口放大后行右侧不再留白；设置页移除 `max-width: 860px`。

## 验证结果

- `cargo test`：16 passed / 0 failed（新增 test_move_to_trash）
- `pnpm build`：tsc + vite 编译通过（logos 资源正常打包）
- UI 走查：本轮未做（用户要求尽量减少测试），建议提交后跑一次 `pnpm tauri dev` 目检

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
