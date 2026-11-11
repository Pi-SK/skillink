import { useEffect, useState, lazy, Suspense } from "react";
import {
  Zap,
  Puzzle,
  FileText,
  Settings,
  RefreshCw,
  Waypoints,
  FolderDown,
  Sun,
  Moon,
  Minus,
  Square,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "./components/Toast";
import { DataProvider, useData } from "./store";
import { NavigationGuardProvider, useNavigationGuard } from "./components/NavigationGuard";
import { SkillsPage } from "./pages/SkillsPage";
import { PluginsPage } from "./pages/PluginsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GlobalTooltip } from "./components/GlobalTooltip";
import {
  importSkill,
  setWindowEffect,
  startWindowDrag,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
} from "./api";
import { isTauri } from "./mock";

// 文档页携带 CodeMirror/marked 等重型依赖，按需加载
const DocsPage = lazy(() =>
  import("./pages/DocsPage").then((m) => ({ default: m.DocsPage }))
);

type PageKey = "skills" | "plugins" | "docs" | "settings";

const NAV_ITEMS: { key: PageKey; label: string; icon: typeof Zap; desc: string }[] = [
  { key: "skills", label: "技能", icon: Zap, desc: "跨 Agent 同步 SKILL.md 技能" },
  { key: "plugins", label: "插件", icon: Puzzle, desc: "整包同步 Plugin 到各 Agent" },
  { key: "docs", label: "指令文档", icon: FileText, desc: "CLAUDE.md / AGENTS.md 全局约束" },
  { key: "settings", label: "设置", icon: Settings, desc: "Agent 注册表与配置" },
];

function Shell() {
  const [page, setPage] = useState<PageKey>("skills");
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("skillink.theme") === "light" ? "light" : "dark"
  );
  const { agents, reload } = useData();
  const { push } = useToast();
  const { guard } = useNavigationGuard();

  const handleReload = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // 动画最低保持 700ms，避免刷新太快导致转圈只闪一下
      await Promise.all([
        reload(),
        new Promise((r) => setTimeout(r, 700)),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("skillink.theme", next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    // 桌面端：切换 Mica 深/浅材质，保持窗口材质与主题一致
    setWindowEffect(next);
  };

  // 左下角概览：活跃 = 未忽略的平台；共 = 检测到（已安装）的平台；均排除 .agents 源目录
  const activeCount = agents.filter((a) => a.key !== "agents" && !a.ignored).length;
  const totalCount = agents.filter((a) => a.key !== "agents" && a.detected).length;
  // Tauri 原生拖拽：拿到真实文件路径直接导入
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      if (cancelled) return;
      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") {
            setDragging(true);
          } else if (p.type === "leave") {
            setDragging(false);
          } else if (p.type === "drop") {
            setDragging(false);
            let ok = 0;
            let fail = 0;
            for (const path of p.paths) {
              try {
                await importSkill(path);
                ok++;
              } catch {
                fail++;
              }
            }
            if (ok > 0) push(`已导入 ${ok} 个技能`, "success");
            if (fail > 0) push(`${fail} 个目录导入失败（缺少 SKILL.md 或已存在）`, fail > 0 && ok === 0 ? "error" : "info");
            if (ok > 0) await reload();
          }
        })
        .then((u) => {
          unlisten = u;
        });
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [push, reload]);

  return (
    <div className="app">
      <nav className="navrail">
        <div className="brand">
          <div className="brand-mark">
            <Waypoints size={17} strokeWidth={2} />
          </div>
          <div className="brand-text">
            <div className="brand-name">Skillink</div>
            <div className="brand-sub">Agent Skill 管理</div>
          </div>
        </div>

        <div className="nav-items">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`nav-item ${page === item.key ? "active" : ""}`}
                onClick={() => guard(() => setPage(item.key))}
              >
                <Icon size={16} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="navrail-footer">
          <button
            className="agent-summary"
            onClick={() => guard(() => setPage("settings"))}
            title="查看 Agent 详情"
          >
            <div className="agent-summary-dots">
              {agents
                .filter((a) => a.key !== "agents")
                .slice(0, 6)
                .map((a) => (
                  <span
                    key={a.key}
                    className={`summary-dot ${a.ignored ? "" : "on"}`}
                    title={`${a.display_name}: ${a.ignored ? "已忽略" : "活跃"}`}
                  />
                ))}
            </div>
            <span className="agent-summary-text">
              活跃 {activeCount} / 共 {totalCount}
            </span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          {/* 无边框窗口拖拽区：空白处按住拖动整个窗口，双击最大化/还原 */}
          <div
            className="topbar-drag"
            data-role="draggable"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (e.detail === 2) {
                // 双击：最大化/还原，不进入拖拽循环
                toggleMaximizeWindow();
              } else {
                startWindowDrag();
              }
            }}
            title="拖动窗口"
          />
          <div className="topbar-actions">
            <button
              className="btn btn-ghost"
              onClick={handleReload}
              disabled={refreshing}
              title={refreshing ? "正在重新扫描…" : "重新扫描"}
            >
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              {refreshing ? "扫描中…" : "刷新"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={toggleTheme}
              title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          {isTauri && (
            <div className="window-controls">
              <button className="win-btn" onClick={minimizeWindow} title="最小化">
                <Minus size={14} />
              </button>
              <button className="win-btn" onClick={toggleMaximizeWindow} title="最大化/还原">
                <Square size={12} />
              </button>
              <button className="win-btn win-btn-close" onClick={closeWindow} title="关闭">
                <X size={14} />
              </button>
            </div>
          )}
        </header>

        <main className="content">
          {page === "skills" && <SkillsPage onOpenSettings={() => setPage("settings")} />}
          {page === "plugins" && <PluginsPage />}
          {page === "docs" && (
            <Suspense fallback={<div className="docs-loading">加载编辑器…</div>}>
              <DocsPage />
            </Suspense>
          )}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>

      {dragging && (
        <div className="drop-veil">
          <div className="drop-veil-card">
            <FolderDown size={26} strokeWidth={1.8} />
            <div>松开以导入 Skill 文件夹</div>
            <div className="drop-veil-hint">需包含 SKILL.md，将复制到 ~/.agents/skills</div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <DataProvider>
        <NavigationGuardProvider>
          <Shell />
          <GlobalTooltip />
        </NavigationGuardProvider>
      </DataProvider>
    </ToastProvider>
  );
}

export default App;
