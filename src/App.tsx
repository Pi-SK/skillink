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
} from "lucide-react";
import { ToastProvider, useToast } from "./components/Toast";
import { DataProvider, useData } from "./store";
import { SkillsPage } from "./pages/SkillsPage";
import { PluginsPage } from "./pages/PluginsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { importSkill } from "./api";
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
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("skillman.theme") === "light" ? "light" : "dark"
  );
  const { agents, reload } = useData();
  const { push } = useToast();

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("skillman.theme", next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  };

  const active = NAV_ITEMS.find((n) => n.key === page)!;
  const detectedCount = agents.filter((a) => a.detected && a.key !== "agents").length;
  const totalCount = agents.filter((a) => a.key !== "agents").length;

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
            <div className="brand-name">Skill Mana</div>
            <div className="brand-sub">Agent 资产管理</div>
          </div>
        </div>

        <div className="nav-items">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`nav-item ${page === item.key ? "active" : ""}`}
                onClick={() => setPage(item.key)}
              >
                <Icon size={16} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="navrail-footer">
          <div className="agent-summary" onClick={() => setPage("settings")} title="查看 Agent 详情">
            <div className="agent-summary-dots">
              {agents
                .filter((a) => a.key !== "agents")
                .slice(0, 6)
                .map((a) => (
                  <span
                    key={a.key}
                    className={`summary-dot ${a.detected ? "on" : ""}`}
                    title={`${a.display_name}: ${a.detected ? "已安装" : "未安装"}`}
                  />
                ))}
            </div>
            <span className="agent-summary-text">
              {detectedCount}/{totalCount} Agents
            </span>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            {active.label}
            <span className="topbar-desc">{active.desc}</span>
          </div>
          <button
            className="btn btn-ghost"
            onClick={toggleTheme}
            title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button className="btn btn-ghost" onClick={reload} title="重新扫描">
            <RefreshCw size={14} />
            刷新
          </button>
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
        <Shell />
      </DataProvider>
    </ToastProvider>
  );
}

export default App;
