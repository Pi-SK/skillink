import { useEffect, useMemo, useState } from "react";
import {
  Search,
  FolderDown,
  ChevronDown,
  Package,
  Sparkles,
  Inbox,
  TriangleAlert,
  HardDriveDownload,
} from "lucide-react";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { Toggle } from "../components/Toggle";
import { EmptyState } from "../components/EmptyState";
import { MatrixSkeleton } from "../components/Skeleton";
import { SkillDrawer } from "../components/SkillDrawer";
import { importSkill, getUnmanaged, getIssues } from "../api";
import { isTauri } from "../mock";
import type { AgentStatus, SkillInfo, UnmanagedItem, Issue } from "../types";

/** 技能页：分组矩阵 + 统计 + 搜索 + 未纳管资产 + 详情抽屉 */
export function SkillsPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { agents, skills, matrix, loading, toggling, toggleSkill, reload } = useData();
  const { push } = useToast();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(
    () => localStorage.getItem("skillman.hideEmptyCols") === "1"
  );
  const [importing, setImporting] = useState(false);
  const [unmanaged, setUnmanaged] = useState<UnmanagedItem[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [drawerSkill, setDrawerSkill] = useState<SkillInfo | null>(null);

  const loadSide = () => {
    getUnmanaged().then(setUnmanaged).catch(() => setUnmanaged([]));
    getIssues().then(setIssues).catch(() => setIssues([]));
  };

  useEffect(loadSide, []);

  // 排除 .agents 源目录自身，它不是同步目标
  const targetAgents = useMemo(() => agents.filter((a) => a.key !== "agents"), [agents]);

  // 每个 agent 列在全部技能中的链接数
  const linkedCountByAgent = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of matrix) {
      if (c.linked) m.set(c.agent_key, (m.get(c.agent_key) ?? 0) + 1);
    }
    return m;
  }, [matrix]);

  // 空列：已检测但 0 链接的 agent
  const visibleAgents = useMemo(() => {
    if (!hideEmpty) return targetAgents;
    return targetAgents.filter(
      (a) => !a.detected || (linkedCountByAgent.get(a.key) ?? 0) > 0
    );
  }, [targetAgents, hideEmpty, linkedCountByAgent]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q)
    );
  }, [skills, search]);

  // 分组：独立在前，plugin 按名称
  const groups = useMemo(() => {
    const standalone = filtered.filter((s) => s.source === "独立");
    const byPlugin = new Map<string, SkillInfo[]>();
    for (const s of filtered) {
      if (s.source === "独立") continue;
      const arr = byPlugin.get(s.source) ?? [];
      arr.push(s);
      byPlugin.set(s.source, arr);
    }
    const result: { key: string; label: string; items: SkillInfo[] }[] = [];
    if (standalone.length > 0) {
      result.push({ key: "独立", label: "独立技能", items: standalone });
    }
    for (const [name, items] of [...byPlugin.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      result.push({ key: name, label: name, items });
    }
    return result;
  }, [filtered]);

  const cellMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of matrix) m.set(`${c.agent_key}::${c.source}::${c.skill_id}`, c.linked);
    return m;
  }, [matrix]);

  const totalLinked = useMemo(() => matrix.filter((c) => c.linked).length, [matrix]);

  const gridCols = `250px 118px repeat(${visibleAgents.length}, minmax(88px, 1fr))`;

  const handleImport = async () => {
    if (!isTauri) {
      push("导入功能仅在桌面端可用", "info");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        title: "选择要导入的 Skill 文件夹（需包含 SKILL.md）",
      });
      if (!picked) return;
      setImporting(true);
      const info = await importSkill(picked as string);
      push(`已导入技能「${info.name}」`, "success");
      await reload();
      loadSide();
    } catch (e) {
      push(`导入失败: ${String(e)}`, "error");
    } finally {
      setImporting(false);
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleHideEmpty = (v: boolean) => {
    setHideEmpty(v);
    localStorage.setItem("skillman.hideEmptyCols", v ? "1" : "0");
  };

  if (loading) return <MatrixSkeleton rows={9} />;

  return (
    <div className="page page-tight">
      <div className="page-toolbar">
        <div className="search-field">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索技能名称 / 描述 / 来源…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="mini-switch-label" title="隐藏「已安装但 0 链接」的 Agent 列">
          <Toggle checked={hideEmpty} onChange={toggleHideEmpty} />
          隐藏空列
        </label>
        <div className="toolbar-spacer" />
        {issues.length > 0 && (
          <button className="issue-chip" onClick={onOpenSettings} title="点击查看体检明细">
            <TriangleAlert size={12} />
            {issues.length} 项待处理
          </button>
        )}
        <span className="toolbar-count">
          {skills.length} 项技能 · 链接 {totalLinked}
          {search && ` · 匹配 ${filtered.length}`}
        </span>
        <button
          className="btn btn-primary"
          onClick={handleImport}
          disabled={importing}
        >
          <FolderDown size={14} />
          {importing ? "导入中…" : "导入技能"}
        </button>
      </div>

      {skills.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="尚未检测到任何技能"
          description="将含 SKILL.md 的文件夹放到 ~/.agents/skills（独立技能）或 ~/.agents/plugins/*/skills/（插件内嵌），或直接导入。"
          action={{ label: "导入第一个技能", onClick: handleImport }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`没有匹配「${search}」的技能`}
          description="试试更短的关键词，或清空搜索框。"
        />
      ) : (
        <div className="matrix-scroll">
          <div className="matrix" style={{ ["--cols" as string]: gridCols }}>
            <div className="m-header">
              <div className="m-cell m-name m-sticky">技能</div>
              <div className="m-cell m-source">来源</div>
              {visibleAgents.map((a) => (
                <AgentColumnHeader
                  key={a.key}
                  agent={a}
                  linked={linkedCountByAgent.get(a.key) ?? 0}
                  total={skills.length}
                />
              ))}
            </div>

            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.key);
              return (
                <div key={g.key}>
                  <div
                    className="m-group"
                    onClick={() => toggleGroup(g.key)}
                    title={isCollapsed ? "展开分组" : "折叠分组"}
                  >
                    <ChevronDown
                      size={14}
                      className={`group-chevron ${isCollapsed ? "collapsed" : ""}`}
                    />
                    {g.key === "独立" ? (
                      <Sparkles size={13} className="group-icon-standalone" />
                    ) : (
                      <Package size={13} className="group-icon-plugin" />
                    )}
                    <span className="group-label">{g.label}</span>
                    <span className="group-count">{g.items.length}</span>
                  </div>
                  {!isCollapsed &&
                    g.items.map((skill) => (
                      <div
                        className="m-row clickable"
                        key={`${skill.source}::${skill.id}`}
                        onClick={() => setDrawerSkill(skill)}
                      >
                        <div
                          className="m-cell m-name m-sticky"
                          title={skill.description || skill.id}
                        >
                          <div className="skill-name-text">{skill.name}</div>
                          <div className="skill-id-text">{skill.id}</div>
                        </div>
                        <div className="m-cell m-source">
                          {skill.source === "独立" ? (
                            <span className="tag tag-standalone">独立</span>
                          ) : (
                            <span className="tag tag-plugin" title={`来自插件 ${skill.source}`}>
                              {skill.source}
                            </span>
                          )}
                        </div>
                        {visibleAgents.map((agent) => {
                          const linked =
                            cellMap.get(`${agent.key}::${skill.source}::${skill.id}`) ?? false;
                          const busy = toggling.has(`${agent.key}::${skill.source}::${skill.id}`);
                          return (
                            <div className="m-cell m-toggle" key={agent.key}>
                              <Toggle
                                checked={linked}
                                busy={busy}
                                disabled={!agent.detected}
                                title={
                                  !agent.detected
                                    ? `${agent.display_name} 未安装`
                                    : linked
                                    ? "已链接 — 点击断开"
                                    : "点击创建链接"
                                }
                                onChange={(next) =>
                                  toggleSkill(agent.key, skill.id, skill.source, next)
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentColumnHeader({
  agent,
  linked,
  total,
}: {
  agent: AgentStatus;
  linked: number;
  total: number;
}) {
  return (
    <div
      className={`m-cell m-agent ${agent.detected ? "" : "missing"}`}
      title={`${agent.display_name} (${agent.key})\n${agent.skills_dir}\n${
        agent.detected ? "已安装" : "未安装"
      } · 已链接 ${linked}/${total}`}
    >
      <span className={`agent-avatar ${agent.detected ? "" : "dim"}`}>
        {agent.display_name.charAt(0).toUpperCase()}
      </span>
      <span className="agent-col-name">{agent.display_name}</span>
      <span className="agent-col-count">
        {agent.detected ? `${linked}/${total}` : "—"}
      </span>
    </div>
  );
}
