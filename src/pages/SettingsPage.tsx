import { FolderOpen, Info } from "lucide-react";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { openAgentsJson } from "../api";
import { isTauri } from "../mock";
import { MatrixSkeleton } from "../components/Skeleton";

/** 设置页：Agent 注册表概览 + 配置入口（应用内编辑为 P2） */
export function SettingsPage() {
  const { agents, loading } = useData();
  const { push } = useToast();

  if (loading) return <MatrixSkeleton rows={6} />;

  const detected = agents.filter((a) => a.detected).length;

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="toolbar-spacer" />
        <span className="toolbar-count">
          已检测 {detected}/{agents.length} 个 Agent
        </span>
        <button
          className="btn"
          onClick={async () => {
            if (!isTauri) {
              push("仅在桌面端可用", "info");
              return;
            }
            try {
              await openAgentsJson();
            } catch (e) {
              push(`打开失败: ${String(e)}`, "error");
            }
          }}
        >
          <FolderOpen size={14} />
          编辑 agents.json
        </button>
      </div>

      <div className="settings-section">
        <h3 className="section-title">Agent 注册表</h3>
        <p className="section-hint">
          内置 {agents.length} 个预设；在 ~/.skillman/agents.json 中按 key 覆盖或新增自定义
          Agent（需包含 key / display_name / skills_dir / detect_dir 字段）。
        </p>
        <div className="agent-table">
          {agents.map((a) => (
            <div className="agent-row" key={a.key}>
              <span className={`status-dot ${a.detected ? "on" : ""}`} />
              <span className="agent-row-name">{a.display_name}</span>
              <span className="agent-row-key">{a.key}</span>
              <div className="toolbar-spacer" />
              {a.sync_mode === "copy" && <span className="tag tag-warn">copy 模式</span>}
              {a.plugins_dir && <span className="tag tag-neutral">插件</span>}
              <span className="agent-row-path" title={a.skills_dir}>
                {a.skills_dir}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="section-title">
          <Info size={14} className="inline-icon" />
          关于
        </h3>
        <p className="section-hint">
          Skill Mana v0.9.0 — 跨平台 AI Agent 资产管理器。 通过 NTFS
          junction（目录链接）在多个 Agent 之间同步 Skills 与
          Plugins，源数据始终保存在 ~/.agents/ 下，不复制、不搬迁。
        </p>
      </div>
    </div>
  );
}
