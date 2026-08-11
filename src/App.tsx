import { useEffect, useState, useCallback } from "react";
import {
  AgentStatus,
  SkillInfo,
  MatrixCell,
  PluginInfo,
  PluginCell,
  getAgents,
  getSkills,
  getMatrix,
  toggleSkill,
  importSkill,
  openAgentsJson,
  getPlugins,
  togglePlugin,
  getPluginMatrix,
} from "./api";

type TabKey = "skills" | "plugins";

function App() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [matrix, setMatrix] = useState<MatrixCell[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginMatrix, setPluginMatrix] = useState<PluginCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState<TabKey>("skills");

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [a, s, m, p, pm] = await Promise.all([
        getAgents(),
        getSkills(),
        getMatrix(),
        getPlugins(),
        getPluginMatrix(),
      ]);
      setAgents(a);
      setSkills(s);
      setMatrix(m);
      setPlugins(p);
      setPluginMatrix(pm);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 技能矩阵查询: agent_key::source::skill_id -> MatrixCell
  const skillCellMap = new Map<string, MatrixCell>();
  for (const c of matrix) {
    skillCellMap.set(`${c.agent_key}::${c.source}::${c.skill_id}`, c);
  }

  const isSkillLinked = (agentKey: string, skillId: string, source: string) =>
    skillCellMap.get(`${agentKey}::${source}::${skillId}`)?.linked ?? false;

  // Plugin 矩阵查询: plugin_name::agent_key -> PluginCell
  const pluginCellMap = new Map<string, PluginCell>();
  for (const c of pluginMatrix) {
    pluginCellMap.set(`${c.plugin_name}::${c.agent_key}`, c);
  }

  const isPluginLinked = (pluginName: string, agentKey: string) =>
    pluginCellMap.get(`${pluginName}::${agentKey}`)?.linked ?? false;

  const handleToggleSkill = async (
    agentKey: string,
    skillId: string,
    enable: boolean,
    source: string
  ) => {
    const key = `${agentKey}::${source}::${skillId}`;
    setToggling((prev) => new Set(prev).add(key));
    try {
      const pluginName = source !== "独立" ? source : undefined;
      await toggleSkill(agentKey, skillId, enable, pluginName);
      await loadAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleTogglePlugin = async (
    agentKey: string,
    pluginName: string,
    enable: boolean
  ) => {
    const key = `plugin::${agentKey}::${pluginName}`;
    setToggling((prev) => new Set(prev).add(key));
    try {
      await togglePlugin(agentKey, pluginName, enable);
      await loadAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    if (items.length > 0) {
      const path = prompt("请输入要导入的 skill 文件夹完整路径:");
      if (path) {
        try {
          await importSkill(path);
          await loadAll();
        } catch (err) {
          setError(String(err));
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const agentsToShow = agents.filter((a) => a.key !== "agents");

  const sortedSkills = [...skills].sort((a, b) => a.id.localeCompare(b.id));
  const filteredSkills = search
    ? sortedSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.id.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : sortedSkills;

  const agentsWithPlugins = agentsToShow.filter((a) => a.plugins_dir);

  // 来源标签
  const sourceLabel = (source: string) => {
    if (source === "独立") return <span className="source-tag standalone">独立</span>;
    return <span className="source-tag plugin">📦 {source}</span>;
  };

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="topbar">
        <button
          className="btn-icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="切换侧栏"
        >
          ☰
        </button>
        <h1 className="app-title">技能管理器</h1>
        <div className="tab-bar">
          <button
            className={`tab-btn ${tab === "skills" ? "active" : ""}`}
            onClick={() => setTab("skills")}
          >
            技能
          </button>
          <button
            className={`tab-btn ${tab === "plugins" ? "active" : ""}`}
            onClick={() => setTab("plugins")}
          >
            插件
          </button>
        </div>
        <input
          className="search-box"
          type="text"
          placeholder="搜索 Skill..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={loadAll} title="刷新">
          🔄 刷新
        </button>
      </header>

      <div className="main-layout">
        {/* 主区域 */}
        <div
          className={`matrix-area ${dragOver ? "drag-over" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {loading && <div className="status-msg">加载中...</div>}
          {error && <div className="status-msg error">错误: {error}</div>}

          {/* ========== 技能 Tab ========== */}
          {!loading && tab === "skills" && skills.length === 0 && (
            <div className="status-msg hint">
              尚未检测到任何技能。请将含 SKILL.md 的文件夹放到 ~/.agents/skills 或 ~/.agents/plugins 目录。
            </div>
          )}

          {!loading && tab === "skills" && skills.length > 0 && (
            <div className="matrix-table">
              <div className="matrix-header">
                <div className="cell skill-name-header">技能名称</div>
                <div className="cell source-header">来源</div>
                {agentsToShow.map((a) => (
                  <div
                    key={a.key}
                    className={`cell agent-header ${a.detected ? "installed" : "missing"}`}
                    title={`${a.display_name} — ${a.detected ? "已安装" : "未安装"}\n${a.skills_dir}`}
                  >
                    {a.display_name}
                    <span className="detect-dot" data-detected={a.detected ? "1" : "0"} />
                  </div>
                ))}
              </div>
              {filteredSkills.map((skill) => (
                <div key={`${skill.source}::${skill.id}`} className="matrix-row">
                  <div className="cell skill-name" title={skill.description || undefined}>
                    <div className="skill-name-text">{skill.name}</div>
                    <div className="skill-id-text">{skill.id}</div>
                  </div>
                  <div className="cell source-cell">
                    {sourceLabel(skill.source)}
                  </div>
                  {agentsToShow.map((agent) => {
                    const linked = isSkillLinked(agent.key, skill.id, skill.source);
                    const busy = toggling.has(`${agent.key}::${skill.source}::${skill.id}`);
                    return (
                      <div key={agent.key} className="cell toggle-cell">
                        <input
                          type="checkbox"
                          checked={linked}
                          disabled={busy || !agent.detected}
                          onChange={(e) =>
                            handleToggleSkill(agent.key, skill.id, e.target.checked, skill.source)
                          }
                          title={
                            busy
                              ? "同步中..."
                              : agent.detected
                              ? linked
                                ? "已链接 — 点击断开"
                                : "点击创建链接"
                              : `${agent.display_name} 未安装`
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* ========== 插件 Tab ========== */}
          {!loading && tab === "plugins" && plugins.length === 0 && (
            <div className="status-msg hint">
              尚未检测到任何插件。请将插件文件夹放到 ~/.agents/plugins 目录。
            </div>
          )}

          {!loading && tab === "plugins" && plugins.length > 0 && (
            <div className="matrix-table">
              <div className="matrix-header">
                <div className="cell skill-name-header">插件名称</div>
                <div className="cell source-header">内含技能</div>
                {agentsWithPlugins.map((a) => (
                  <div
                    key={a.key}
                    className={`cell agent-header ${a.detected ? "installed" : "missing"}`}
                    title={`${a.display_name} — ${a.plugins_dir}`}
                  >
                    {a.display_name}
                    <span className="detect-dot" data-detected={a.detected ? "1" : "0"} />
                  </div>
                ))}
              </div>
              {plugins.map((p) => (
                <div key={p.name} className="matrix-row">
                  <div className="cell skill-name">
                    <div className="skill-name-text">{p.name}</div>
                  </div>
                  <div className="cell source-cell">
                    {p.has_skills ? (
                      <span className="source-tag plugin">📦 {p.skill_count} 个</span>
                    ) : (
                      <span className="source-tag none">—</span>
                    )}
                  </div>
                  {agentsWithPlugins.map((agent) => {
                    const linked = isPluginLinked(p.name, agent.key);
                    const busy = toggling.has(`plugin::${agent.key}::${p.name}`);
                    return (
                      <div key={agent.key} className="cell toggle-cell">
                        <input
                          type="checkbox"
                          checked={linked}
                          disabled={busy || !agent.detected}
                          onChange={(e) =>
                            handleTogglePlugin(agent.key, p.name, e.target.checked)
                          }
                          title={
                            busy
                              ? "同步中..."
                              : agent.detected
                              ? linked
                                ? "已链接 — 点击断开"
                                : "点击同步插件"
                              : `${agent.display_name} 未安装`
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 侧栏 */}
        {sidebarOpen && (
          <aside className="sidebar">
            <h3>Agent 列表</h3>
            <ul className="agent-list">
              {agents.map((a) => (
                <li
                  key={a.key}
                  className={`agent-item ${a.detected ? "detected" : "not-detected"}`}
                >
                  <span className={`status-dot ${a.detected ? "green" : "gray"}`} />
                  <span className="agent-name">{a.display_name}</span>
                  <span className="agent-key">({a.key})</span>
                  {a.sync_mode === "copy" && (
                    <span className="badge">copy</span>
                  )}
                  {a.plugins_dir && (
                    <span className="badge badge-plugin">🔌</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="sidebar-actions">
              <button className="btn btn-sm" onClick={openAgentsJson}>
                📝 配置 agents.json
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const path = prompt("请输入要导入的 Skill 文件夹完整路径:");
                  if (path) {
                    importSkill(path)
                      .then(() => loadAll())
                      .catch((e) => setError(String(e)));
                  }
                }}
              >
                📥 导入 Skill
              </button>
            </div>

            <div className="sidebar-help">
              <h4>使用说明</h4>
              <ul>
                <li><b>技能</b>：从 ~/.agents/skills（独立）或 ~/.agents/plugins/*/skills/（插件内嵌）管理 SKILL.md 技能</li>
                <li><b>插件</b>：同步完整插件包到各 Agent 的 plugins 目录</li>
                <li>勾选 = 创建目录 junction（符号链接）</li>
                <li>取消 = 删除 junction（不删原始数据）</li>
                <li>拖入文件夹可导入 Skill</li>
                <li>新增 Agent：编辑 ~/.skillman/agents.json</li>
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
