import { useEffect, useMemo, useState } from "react";
import { Package, Puzzle, Boxes, HardDriveDownload } from "lucide-react";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { EmptyState } from "../components/EmptyState";
import { MatrixSkeleton } from "../components/Skeleton";
import { getUnmanaged } from "../api";
import type { AgentStatus, PluginInfo, UnmanagedItem } from "../types";

/** 插件页：卡片网格，每张卡片内嵌各 Agent 的同步开关 */
export function PluginsPage() {
  const { agents, plugins, pluginMatrix, loading, toggling, togglePlugin } = useData();
  const { push } = useToast();
  const [unmanaged, setUnmanaged] = useState<UnmanagedItem[]>([]);

  useEffect(() => {
    getUnmanaged().then(setUnmanaged).catch(() => setUnmanaged([]));
  }, []);

  // 反向发现：各 Agent 目录下非 ~/.agents 链接来的插件（只读）
  const unmanagedPlugins = useMemo(
    () => unmanaged.filter((u) => u.kind === "plugin"),
    [unmanaged]
  );

  const pluginAgents = useMemo(
    () => agents.filter((a) => a.plugins_dir && a.key !== "agents"),
    [agents]
  );

  const linkedMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of pluginMatrix) m.set(`${c.plugin_name}::${c.agent_key}`, c.linked);
    return m;
  }, [pluginMatrix]);

  if (loading) return <MatrixSkeleton rows={5} />;

  if (plugins.length === 0 && unmanagedPlugins.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon={Puzzle}
          title="尚未检测到任何插件"
          description="将插件文件夹（含 .claude-plugin/plugin.json 或 commands/、skills/ 等标准结构）放到 ~/.agents/plugins 目录后刷新。"
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="toolbar-spacer" />
        <span className="toolbar-count">
          {plugins.length} 个插件 · {pluginAgents.filter((a) => a.detected).length} 个支持插件的 Agent
        </span>
      </div>

      {plugins.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="尚未纳管任何插件"
          description="将插件文件夹放到 ~/.agents/plugins 目录后刷新，即可在此同步到各 Agent。"
        />
      ) : (
        <div className="plugin-grid">
        {plugins.map((p) => (
          <PluginCard
            key={p.name}
            plugin={p}
            agents={pluginAgents}
            linkedMap={linkedMap}
            toggling={toggling}
            onToggle={(agentKey, enable) => {
              const agent = pluginAgents.find((a) => a.key === agentKey);
              if (!agent?.detected) {
                push(`${agent?.display_name ?? agentKey} 未安装`, "info");
                return;
              }
              togglePlugin(agentKey, p.name, enable);
            }}
          />
        ))}
        </div>
      )}

      {unmanagedPlugins.length > 0 && (
        <div className="unmanaged-section">
          <div className="unmanaged-head">
            <HardDriveDownload size={13} className="group-icon-local" />
            <span className="section-label">
              本地未纳管插件（{unmanagedPlugins.length}）
            </span>
            <span className="unmanaged-hint">各 Agent 目录下非 ~/.agents 链接来的插件，仅展示</span>
          </div>
          <div className="unmanaged-rows">
            {unmanagedPlugins.map((u) => {
              const agent = agents.find((a) => a.key === u.agent_key);
              return (
                <div className="unmanaged-row" key={u.path} title={u.path}>
                  <Puzzle size={14} className="group-icon-local" />
                  <span className="unmanaged-name">{u.name}</span>
                  <span className="tag tag-local">本地</span>
                  <span className="unmanaged-agent">{agent?.display_name ?? u.agent_key}</span>
                  <div className="toolbar-spacer" />
                  <span className="unmanaged-path">{u.link_target ?? u.path}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PluginCard({
  plugin,
  agents,
  linkedMap,
  toggling,
  onToggle,
}: {
  plugin: PluginInfo;
  agents: AgentStatus[];
  linkedMap: Map<string, boolean>;
  toggling: Set<string>;
  onToggle: (agentKey: string, enable: boolean) => void;
}) {
  const linkedCount = agents.filter((a) => linkedMap.get(`${plugin.name}::${a.key}`)).length;

  return (
    <div className="plugin-card">
      <div className="plugin-card-head">
        <div className="plugin-card-icon">
          <Package size={17} strokeWidth={1.8} />
        </div>
        <div className="plugin-card-title">
          <div className="plugin-name">{plugin.name}</div>
          <div className="plugin-desc">
            {plugin.description || "暂无描述"}
          </div>
        </div>
      </div>

      <div className="plugin-card-meta">
        <span className="tag tag-neutral">
          <Boxes size={11} />
          {plugin.has_skills ? `内含 ${plugin.skill_count} 个技能` : "无内嵌技能"}
        </span>
        <span className={`tag ${linkedCount > 0 ? "tag-linked" : "tag-neutral"}`}>
          已同步 {linkedCount}/{agents.length}
        </span>
      </div>

      <div className="plugin-agent-rows">
        {agents.map((agent) => {
          const linked = linkedMap.get(`${plugin.name}::${agent.key}`) ?? false;
          const busy = toggling.has(`plugin::${agent.key}::${plugin.name}`);
          return (
            <div className="plugin-agent-row" key={agent.key}>
              <span className={`status-dot ${agent.detected ? "on" : ""}`} />
              <span className={`plugin-agent-name ${agent.detected ? "" : "dim"}`}>
                {agent.display_name}
              </span>
              {!agent.detected && <span className="dim-hint">未安装</span>}
              <div className="toolbar-spacer" />
              <button
                type="button"
                role="switch"
                aria-checked={linked}
                className={`switch mini ${linked ? "on" : ""} ${busy ? "busy" : ""}`}
                disabled={!agent.detected || busy}
                title={
                  !agent.detected
                    ? `${agent.display_name} 未安装`
                    : linked
                    ? "已同步 — 点击移除"
                    : "点击同步到此 Agent"
                }
                onClick={() => onToggle(agent.key, !linked)}
              >
                <span className="knob" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
