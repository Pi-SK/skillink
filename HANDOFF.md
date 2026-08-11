# HANDOFF.md — Skill Mana 设计重点与避坑记录

> 本文档记录 Skill Mana（技能管理器）v0.1.0 开发过程中涉及的核心架构决策、跨 Agent 兼容性发现、以及踩过的坑，供后续迭代参考。

---

## 1. 产品定位

Skill Mana 是一个 **Tauri 桌面工具**，用于在本地多个 AI Agent 之间同步 Skills 和 Plugins。核心机制是 **NTFS junction（目录符号链接）**——不复制数据，只创建指向 `~/.agents/` 下唯一源目录的链接。

### 同步模型：三层架构

```
~/.agents/
├── skills/                   ← 层级 1：独立 Skill
│   └── paper-analyzer/       ──→ junction → 各 Agent skills_dir/skill_id/
├── plugins/                  ← 层级 2 + 3：Plugin 包
│   └── product-design/
│       ├── skills/           ← 层级 2：Plugin 内嵌 Skill
│       │   └── audit/        ──→ junction → 各 Agent skills_dir/skill_id/
│       ├── commands/
│       ├── agents/
│       └── ...               ← 层级 3：Plugin 本体
│                              ──→ junction → 各 Agent plugins_dir/plugin_name/
```

**设计原则**：Skill 永远不脱离 Plugin 单独复制。Plugin 内嵌 Skill 的 junction 直接从 Plugin 内部指向 Agent 的 `skills_dir`，保持数据归属清晰。

---

## 2. 跨 Agent 兼容性发现

### 2.1 QwenWork = QoderWork 的演进版

- **QoderWork** 已整合进 **QwenWork**（`~/.qwenworkcn/`）
- 两者目录结构完全一致：`plugins/`、`plugins-custom/`、`skills/`、`commands/`
- 旧版 `~/.qoderwork/` 只保留了 `slides-templates/` 和 `vm/`，没有 skills/plugins

### 2.2 QwenWork 与 Claude Code 的 Plugin 互通

**QwenWork 完全兼容 Claude Code 的 Plugin 格式**：
- 都使用 `.claude-plugin/plugin.json` 作为入口
- 都遵循 `commands/`、`agents/`、`skills/`、`hooks/` 的标准目录结构
- 同一个 Plugin（如 `academic-research-skills`、`product-design`）在两边可以互换安装

```
~/.qwenworkcn/plugins-custom/academic-research-skills/
├── .claude-plugin/plugin.json    ← 标准 Claude Code Plugin 格式
├── commands/
├── agents/
├── skills/
└── ...

~/.claude/plugins/data/academic-research-skills-inline/
└── ... (完全相同的结构)
```

有些 Plugin 甚至同时包含 `.claude-plugin/` 和 `.qoder-plugin/` 双标记。

### 2.3 Codex Plugin 不通

Codex 的 Plugin 系统（`~/.codex/plugins/`）是 OpenAI 专属生态，用于 Google Calendar、Slack 等官方集成，**不与 QwenWork/Claude 的 marketplace Plugin 互通**。

### 2.4 Agent 注册表覆盖

| Agent | key | skills_dir | plugins_dir | 互通群体 |
|---|---|---|---|---|
| Codex | `codex` | `~/.codex/skills` | — | — |
| Claude Code | `claude` | `~/.claude/skills` | `~/.claude/plugins/data` | QwenWork / QoderWork |
| Qoder | `qoder` | `~/.qoder/skills` | `~/.qoder/plugins` | QwenWork / QoderWork |
| **QwenWork CN** | `qwenworkcn` | `~/.qwenworkcn/skills` | `~/.qwenworkcn/plugins-custom` | Claude / Qoder / QoderWork |
| **QoderWork CN** | `qoderworkcn` | `~/.qoderworkcn/skills` | `~/.qoderworkcn/plugins-custom` | Claude / Qoder / QwenWork |
| QoderWork (旧) | `qoderwork` | `~/.qoderwork/skills` | — | — |
| Trae | `trae` | `~/.trae/skills` | — | — |
| Trae CN | `trae-cn` | `~/.trae-cn/skills` | — | — |
| GitHub Copilot | `copilot` | `~/.copilot/skills` | — | — |

---

## 3. 架构决策记录 (ADR)

### ADR-1：SkillInfo 加 `source` 字段区分来源

`SkillInfo` 增加 `source: String` 字段，值可为 `"独立"` 或 Plugin 名。这使得 Skill 矩阵中的每一行都能追溯其归属，UI 据此渲染不同的来源标签（蓝色 = 独立 / 橙色 = Plugin）。

### ADR-2：`plugins_dir` 为可选字段

Agent 注册表中 `plugins_dir: Option<String>`，只有支持 Plugin 同步的 Agent（QwenWork、QoderWork、Claude、Qoder）才填写。UI 中的「插件」Tab 只显示带 `plugins_dir` 的 Agent。

### ADR-3：Plugin Skill 的 junction 目标仍是 `skills_dir`

Plugin 内的 Skill 被 junction 到 Agent 的 `skills_dir/`（而非 `plugins_dir/`），这样才能被 Agent 的 Skill 扫描器发现。Plugin 本体才 junction 到 `plugins_dir/`。

---

## 4. 避坑记录

### 坑 1：Tauri MSI 构建需显式声明 icon.ico

**现象**：
```
Built application at: target/release/agent-skill-mana.exe
failed to bundle project: `Couldn't find a .ico icon`
```

**原因**：`tauri.conf.json` 的 `bundle.icon` 只写了 `["icons/icon.png"]`，Windows MSI/NSIS 打包需要显式包含 `.ico`。

**修复**：
```json
"icon": ["icons/icon.png", "icons/icon.ico"]
```

### 坑 2：写死 sticky left 像素值导致列重叠

**现象**：在技能矩阵中新增"来源"列后，使用 `position: sticky; left: 180px` 手动对齐，导致来源列与技能名列在不同宽度下出现重叠或缝隙。

**原因**：`skill-name` 列的 `min-width: 180px` 和 `max-width: 250px` 是动态的，而来源列的 `left: 180px` 是写死的，两者不一致。

**修复**：来源列不设为 sticky，只保留技能名列 sticky。让来源列随 Agent 列一起横向滚动。

### 坑 3：整个文件重写（Write）破坏原有设计语言

**现象**：用户反馈"之前的 UI 设计语言很好看，为什么不能直接在第一版的基础上修改"。

**教训**：对已有文件，**始终使用 SearchReplace 做增量修改**，不要用 Write 全量覆盖。即使改动量很大，也应分解为多个 targeted 的 SearchReplace 调用。保留原始设计基调，只在需要的位置做手术式修改。

### 坑 4：SearchReplace 的替换链陷阱

**现象**：一次 SearchReplace 调用中包含多个替换，前一个替换吞掉了后一个依赖的文本，导致后者匹配失败。

**教训**：设计 SearchReplace 调用时，确保多个替换的 `original_text` 彼此互斥（没有重叠范围）。单个替换失败时，Read 文件确认当前内容后再重试。

### 坑 5：PowerShell 不支持 `&&` 语句分隔

项目环境 shell 为 `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`，不支持 `&&` 连接命令。需用 `;` 替代。

---

## 5. 文件结构速查

```
agent_skill_mana/
├── src/                       # React 前端
│   ├── App.tsx                # 主界面（Skills/Plugins 双 Tab）
│   ├── App.css                # 样式（暗色主题，skill-name sticky）
│   └── api.ts                 # Tauri invoke 封装
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs             # 命令注册
│   │   ├── commands.rs        # toggle_skill, toggle_plugin, get_matrix 等
│   │   ├── registry.rs        # Agent 注册表（内置 + 用户自定义）
│   │   ├── scanner.rs         # Skill/Plugin 扫描 + SKILL.md 解析
│   │   └── sync.rs            # NTFS junction 创建/删除/检测
│   ├── tauri.conf.json        # 构建配置（icon 需含 .ico）
│   └── icons/                 # 应用图标
├── HANDOFF.md                 # 本文档
└── package.json
```

---

## 6. 后续方向

- [ ] VSIX Extension 同步支持（`.qoder/extensions/` 等）
- [ ] Plugin marketplace 注册表自动发现（避免手动复制到 `~/.agents/plugins/`）
- [ ] Skill 冲突检测（多个 Plugin 含同名 Skill 时提示）
- [ ] macOS/Linux 的 symlink 支持（当前仅 NTFS junction）
