# Skillink

Skillink 是一个面向 Windows 的本地桌面工具，用于管理和同步多个 AI Agent 的 Skills、Plugins 和指令文档。项目采用 Tauri 2、React、TypeScript 和 Rust 构建。

## 功能

- 查看并管理集中存放的 Skills 和 Plugins，将它们同步到各 Agent 目录。
- 发现各 Agent 目录中尚未纳管的资源，按需复制或接管，并提供冲突与链接状态检查。
- 编辑 Agent 指令文档，管理共享片段和文档备份。
- 管理内置及自定义 Agent 的目录和同步方式。

当前实现以 Windows 的 NTFS junction 目录链接为基础，也支持复制模式。junction 创建失败时，自动同步会尝试回退到复制；复制产生的是独立副本。插件同步取决于目标 Agent 是否配置了插件目录。

## 本地开发

准备 Windows 环境、Node.js、pnpm、Rust 和 Tauri 所需的 C++ 构建工具及 WebView2。开发环境及工具链的安装说明可参阅 [Tauri 2 环境准备](https://v2.tauri.app/start/prerequisites/)。本次整理使用 Node.js 24、pnpm 11.25 和 Rust 1.97；项目依赖的 `marked` 要求 Node.js 20 或更高版本。

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

其他常用命令：

```powershell
# 检查 TypeScript 并构建前端
pnpm build

# 运行 Rust 测试
cargo test --locked --manifest-path src-tauri/Cargo.toml

# 构建桌面安装包
pnpm tauri build
```

`pnpm dev` 可以在浏览器中预览界面，但浏览器使用模拟数据；访问和修改实际 Agent 资源需要运行 Tauri 桌面端。

## 数据位置

以下路径中的 `~` 对应 Windows 用户目录：

- `~/.agents/skills/` 和 `~/.agents/plugins/`：集中管理的技能和插件。
- `~/.skillink/agents.json`：用户自定义 Agent 和配置。
- `~/.skillink/backups/`：指令文档及接管操作产生的备份。
- `~/.skillink/snippets/` 和 `~/.skillink/.trash/`：共享片段及回收区。

接管操作会影响原资源目录；删除已纳管资源时，程序会尝试清理指向它的链接并将源目录移入回收区。操作前请留意界面中的具体说明和处理结果。

## 项目结构

```text
src/             React 界面及前端调用
src-tauri/src/   Rust 命令、扫描、同步和指令文档管理
src-tauri/icons/ 应用图标
assets/          图标源文件
```

[HANDOFF.md](HANDOFF.md) 和 [NEXT_STEPS.md](NEXT_STEPS.md) 保留早期开发过程中的记录，其中的名称、路径和状态可能已经过时。
