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
  CheckSquare,
  Square,
  Trash2,
  EyeOff,
  ChevronsDownUp,
} from "lucide-react";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { Toggle } from "../components/Toggle";
import { EmptyState } from "../components/EmptyState";
import { MatrixSkeleton } from "../components/Skeleton";
import { SkillDrawer } from "../components/SkillDrawer";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { importSkill, getUnmanaged, getIssues, adoptSkill, deleteSkill } from "../api";
import { isTauri } from "../mock";
import { AgentBrandIcon } from "../AgentIcon";
import type { AgentStatus, SkillInfo, UnmanagedItem, Issue } from "../types";

/** 技能页：分组矩阵 + 统计 + 搜索 + 未纳管资产 + 详情抽屉 */
export function SkillsPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { agents, skills, matrix, loading, toggling, toggleSkill, reload } = useData();
  const { push } = useToast();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(
    () => localStorage.getItem("skillink.hideEmptyCols") === "1"
  );
  const [importing, setImporting] = useState(false);
  const [unmanaged, setUnmanaged] = useState<UnmanagedItem[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [drawerSkill, setDrawerSkill] = useState<SkillInfo | null>(null);
  const [adoptTarget, setAdoptTarget] = useState<UnmanagedItem | null>(null);
  const [adoptMode, setAdoptMode] = useState<"move" | "copy">("move");
  const [adopting, setAdopting] = useState(false);
  // 同名冲突
  const [conflictTarget, setConflictTarget] = useState<UnmanagedItem | null>(null);
  const [conflictMode, setConflictMode] = useState<"move" | "copy">("move");
  const [conflicting, setConflicting] = useState(false);
  // 行头多选：m:: 前缀 = 纳管技能（可删除），u:: 前缀 = 未纳管资产（可批量纳管）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [batchAdoptOpen, setBatchAdoptOpen] = useState(false);
  const [batchAdoptMode, setBatchAdoptMode] = useState<"move" | "copy">("move");
  const [batchAdopting, setBatchAdopting] = useState(false);

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

  // 空列：已检测但 0 链接的 agent，以及被忽略的 agent
  const visibleAgents = useMemo(() => {
    return targetAgents.filter((a) => {
      // 被忽略的平台折叠
      if (a.ignored) return false;
      if (!hideEmpty) return true;
      return !a.detected || (linkedCountByAgent.get(a.key) ?? 0) > 0;
    });
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

  // 被忽略的平台
  const ignoredAgents = useMemo(
    () => targetAgents.filter((a) => a.ignored),
    [targetAgents]
  );

  // 未纳管技能：按 agent 分组（反向发现，只读展示）
  const unmanagedSkillGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byAgent = new Map<string, UnmanagedItem[]>();
    for (const u of unmanaged) {
      if (u.kind !== "skill") continue;
      if (q && !u.name.toLowerCase().includes(q)) continue;
      const arr = byAgent.get(u.agent_key) ?? [];
      arr.push(u);
      byAgent.set(u.agent_key, arr);
    }
    return [...byAgent.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [unmanaged, search]);

  // 一键折叠状态：覆盖纳管分组 + 未纳管分组
  const allCollapsed = useMemo(() => {
    const allGroupKeys = [
      ...groups.map((g) => g.key),
      ...unmanagedSkillGroups.map(([agentKey]) => `unmanaged::${agentKey}`),
    ];
    if (allGroupKeys.length === 0) return false;
    return allGroupKeys.every((k) => collapsed.has(k));
  }, [collapsed, groups, unmanagedSkillGroups]);

  const cellMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of matrix) m.set(`${c.agent_key}::${c.source}::${c.skill_id}`, c.linked);
    return m;
  }, [matrix]);

  const totalLinked = useMemo(() => matrix.filter((c) => c.linked).length, [matrix]);

  // 列模板：行头多选框 + 名称（弹性） + 来源 + 版本 + 时间 + 间隔 + 各 Agent（固定宽度）+ 尾部填充
  const gridCols = visibleAgents.length > 0
    ? `30px minmax(300px, 4fr) 86px 56px 80px 10px repeat(${visibleAgents.length}, 60px) minmax(0, 1fr)`
    : `30px minmax(300px, 4fr) 86px 56px 80px`;

  const managedKey = (s: SkillInfo) => `m::${s.source}::${s.id}`;
  const unmanagedKey = (u: UnmanagedItem) => `u::${u.path}`;

  const selectedManaged = useMemo(
    () => skills.filter((s) => selected.has(managedKey(s))),
    [skills, selected]
  );
  const selectedUnmanaged = useMemo(
    () => unmanaged.filter((u) => u.kind === "skill" && selected.has(unmanagedKey(u))),
    [unmanaged, selected]
  );

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectKeys = (keys: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = keys.length > 0 && keys.every((k) => next.has(k));
      keys.forEach((k) => (all ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  // mtime 格式化
  const fmtMtime = (ms: number) => {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${d.getFullYear().toString().slice(2)}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
  };

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

  const toggleAllGroups = () => {
    if (allCollapsed) {
      // 全部展开
      setCollapsed(new Set());
    } else {
      // 全部折叠
      const allKeys = new Set([
        ...groups.map((g) => g.key),
        ...unmanagedSkillGroups.map(([agentKey]) => `unmanaged::${agentKey}`),
      ]);
      setCollapsed(allKeys);
    }
  };

  const toggleHideEmpty = (v: boolean) => {
    setHideEmpty(v);
    localStorage.setItem("skillink.hideEmptyCols", v ? "1" : "0");
  };

  const confirmAdopt = async () => {
    if (!adoptTarget) return;
    setAdopting(true);
    try {
      await adoptSkill(adoptTarget.path, adoptMode);
      push(`已纳管技能「${adoptTarget.name}」`, "success");
      setAdoptTarget(null);
      await reload();
      loadSide();
    } catch (e) {
      push(`纳管失败: ${String(e)}`, "error");
    } finally {
      setAdopting(false);
    }
  };

  const confirmConflictAdopt = async () => {
    if (!conflictTarget) return;
    setConflicting(true);
    try {
      await adoptSkill(conflictTarget.path, conflictMode, true);
      push(`已合并覆盖技能「${conflictTarget.name}」`, "success");
      setConflictTarget(null);
      await reload();
      loadSide();
    } catch (e) {
      push(`合并失败: ${String(e)}`, "error");
    } finally {
      setConflicting(false);
    }
  };

  const confirmBatchAdopt = async () => {
    if (selectedUnmanaged.length === 0) return;
    setBatchAdopting(true);
    let ok = 0;
    let fail = 0;
    let conflict = 0;
    for (const item of selectedUnmanaged) {
      try {
        // 已纳管源中存在同名技能时自动走合并覆盖（与单行「合并覆盖」一致），避免整条失败
        const overwrite = skills.some((s) => s.id === item.name);
        if (overwrite) conflict++;
        await adoptSkill(item.path, batchAdoptMode, overwrite);
        ok++;
      } catch {
        fail++;
      }
    }
    const extra = conflict > 0 ? `，其中合并覆盖 ${conflict} 项同名` : "";
    push(`批量纳管完成：成功 ${ok} 项${extra}${fail > 0 ? `，失败 ${fail} 项` : ""}`, fail === 0 ? "success" : "info");
    setSelected((prev) => new Set([...prev].filter((k) => !k.startsWith("u::"))));
    setBatchAdoptOpen(false);
    setBatchAdopting(false);
    await reload();
    loadSide();
  };

  const confirmDelete = async () => {
    if (selectedManaged.length === 0) return;
    setDeleting(true);
    let ok = 0;
    let fail = 0;
    let links = 0;
    for (const s of selectedManaged) {
      try {
        const r = await deleteSkill(s.id, s.source === "独立" ? undefined : s.source);
        ok++;
        links += r.removed_links;
      } catch (e) {
        fail++;
        push(`删除「${s.name}」失败: ${String(e)}`, "error");
      }
    }
    push(
      `已删除 ${ok} 项技能${links > 0 ? `，清理 ${links} 个链接` : ""}（已移入回收区）${fail > 0 ? `，失败 ${fail} 项` : ""}`,
      fail === 0 ? "success" : "info"
    );
    setSelected((prev) => new Set([...prev].filter((k) => !k.startsWith("m::"))));
    setDeleteOpen(false);
    setDeleting(false);
    await reload();
    loadSide();
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
        {(groups.length > 0 || unmanagedSkillGroups.length > 0) && (
          <button
            className="btn btn-sm btn-ghost"
            title={allCollapsed ? "展开全部技能分组" : "折叠全部技能分组"}
            onClick={toggleAllGroups}
          >
            <ChevronsDownUp size={14} />
            {allCollapsed ? "全部展开" : "一键折叠"}
          </button>
        )}
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

      {/* Agent 链接统计面板（CC-SWITCH 风格） */}
      {targetAgents.length > 0 && (
        <div className="agent-stats-bar">
          <span className="agent-stats-label">已检测到各 Agents 平台的链接数：</span>
          {targetAgents.map((a) => {
            const linked = linkedCountByAgent.get(a.key) ?? 0;
            const isIgnored = a.ignored;
            return (
              <div
                key={a.key}
                className={`agent-stat-chip ${!a.detected ? "missing" : ""} ${isIgnored ? "ignored" : ""} ${linked > 0 ? "active" : ""}`}
                title={`${a.display_name}\n${a.skills_dir}\n${a.detected ? "已安装" : "未安装"} · 已链接 ${linked} 项${isIgnored ? " · 已忽略" : ""}`}
              >
                <AgentBrandIcon agentKey={a.key} linked={a.detected && !isIgnored} size={16} />
                <span className="agent-stat-name">{shortAgentName(a.display_name)}</span>
                <span className="agent-stat-count">{isIgnored ? "—" : linked}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 已忽略平台提示 */}
      {ignoredAgents.length > 0 && (
        <div className="ignored-hint-bar">
          <EyeOff size={13} />
          <span>已忽略平台：{ignoredAgents.map((a) => a.display_name).join("、")}</span>
          <button className="link-btn" onClick={onOpenSettings}>
            前往设置
          </button>
        </div>
      )}

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
        <>
        {/* 多选操作：嵌在技能表表头正上方，不悬浮、不占额外布局 */}
        {selected.size > 0 && (
          <div className="selection-bar">
            <span className="selection-count">已选 {selected.size} 项</span>
            {selectedManaged.length > 0 && (
              <button className="btn btn-sm btn-danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={13} />
                删除 ({selectedManaged.length})
              </button>
            )}
            {selectedUnmanaged.length > 0 && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setBatchAdoptMode("move");
                  setBatchAdoptOpen(true);
                }}
              >
                <HardDriveDownload size={13} />
                纳管 ({selectedUnmanaged.length})
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
              清除选择
            </button>
          </div>
        )}
        <div className="matrix-scroll">
          <div className="matrix" style={{ ["--cols" as string]: gridCols }}>
            <div className="m-header">
              <div
                className="m-cell m-chk"
                title="全选 / 取消全选（当前筛选结果）"
                onClick={() => toggleSelectKeys(filtered.map(managedKey))}
              >
                {filtered.length > 0 && filtered.every((s) => selected.has(managedKey(s))) ? (
                  <CheckSquare size={14} />
                ) : (
                  <Square size={14} />
                )}
              </div>
              <div className="m-cell m-name m-sticky">技能</div>
              <div className="m-cell m-source">来源</div>
              <div className="m-cell m-ver">版本</div>
              <div className="m-cell m-time">修改时间</div>
              <div className="m-cell m-gap" />
              {visibleAgents.map((a) => (
                <AgentIconHeader
                  key={a.key}
                  agent={a}
                  linked={linkedCountByAgent.get(a.key) ?? 0}
                  total={skills.length}
                />
              ))}
              <div className="m-cell m-fill" />
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
                          className={`m-cell m-chk ${selected.has(managedKey(skill)) ? "on" : ""}`}
                          title={selected.has(managedKey(skill)) ? "取消选择" : "选择（可批量删除）"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(managedKey(skill));
                          }}
                        >
                          {selected.has(managedKey(skill)) ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </div>
                        <div
                          className="m-cell m-name m-sticky"
                          title={skill.description || skill.id}
                        >
                          <div className="skill-name-text">{skill.name}</div>
                          <div className="skill-desc-text">{skill.description || skill.id}</div>
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
                        <div className="m-cell m-ver">{skill.version}</div>
                        <div className="m-cell m-time">{fmtMtime(skill.mtime_ms)}</div>
                        <div className="m-cell m-gap" />
                        {visibleAgents.map((agent) => {
                          const linked =
                            cellMap.get(`${agent.key}::${skill.source}::${skill.id}`) ?? false;
                          const busy = toggling.has(`${agent.key}::${skill.source}::${skill.id}`);
                          return (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={linked}
                              aria-label={`${agent.display_name} 同步「${skill.name}」`}
                              className={`m-cell m-icon-toggle ${busy ? "busy" : ""} ${linked ? "linked" : ""}`}
                              key={agent.key}
                              disabled={!agent.detected || busy}
                              title={
                                !agent.detected
                                  ? `${agent.display_name} 未安装`
                                  : linked
                                  ? "已链接 — 点击断开"
                                  : "点击创建链接"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (agent.detected && !busy) {
                                  toggleSkill(agent.key, skill.id, skill.source, !linked);
                                }
                              }}
                            >
                              <AgentBrandIcon agentKey={agent.key} linked={linked} />
                            </button>
                          );
                        })}
                        <div className="m-cell m-fill" />
                      </div>
                    ))}
                </div>
              );
            })}

            {unmanagedSkillGroups.length > 0 && (
              <div className="unmanaged-batch-bar">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    toggleSelectKeys(
                      unmanagedSkillGroups.flatMap(([, items]) => items.map(unmanagedKey))
                    )
                  }
                >
                  {unmanagedSkillGroups.every(([, items]) =>
                    items.every((u) => selected.has(unmanagedKey(u)))
                  ) ? (
                    <CheckSquare size={13} />
                  ) : (
                    <Square size={13} />
                  )}
                  全选未纳管
                </button>
                <span className="unmanaged-hint">勾选后可在上方操作栏批量纳管</span>
              </div>
            )}

            {unmanagedSkillGroups.map(([agentKey, items]) => {
              const agent = agents.find((a) => a.key === agentKey);
              const gKey = `unmanaged::${agentKey}`;
              const isCollapsed = collapsed.has(gKey);
              return (
                <div key={gKey}>
                  <div
                    className="m-group"
                    onClick={() => toggleGroup(gKey)}
                    title={isCollapsed ? "展开分组" : "折叠分组"}
                  >
                    <ChevronDown
                      size={14}
                      className={`group-chevron ${isCollapsed ? "collapsed" : ""}`}
                    />
                    <HardDriveDownload size={13} className="group-icon-local" />
                    <span className="group-label">
                      本地未纳管 · {agent?.display_name ?? agentKey}
                    </span>
                    <span className="group-count">{items.length}</span>
                  </div>
                  {!isCollapsed &&
                    items.map((u) => {
                      const checked = selected.has(unmanagedKey(u));
                      return (
                      <div className="m-row unmanaged" key={u.path} title={`${u.path}\n${u.description || "非 ~/.agents 管理，可纳管"}`}>
                        <div
                          className={`m-cell m-chk ${checked ? "on" : ""}`}
                          title={checked ? "取消选择" : "选中批量纳管"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(unmanagedKey(u));
                          }}
                        >
                          {checked ? <CheckSquare size={14} /> : <Square size={14} />}
                        </div>
                        <div className="m-cell m-name m-sticky">
                          <div className="skill-name-text">{u.name}</div>
                          <div className="skill-desc-text">{u.description || u.link_target || u.path}</div>
                        </div>
                        <div className="m-cell m-source">
                          {u.source === "独立" ? (
                            <span className="tag tag-local">本地</span>
                          ) : (
                            <span className="tag tag-local" title={`内嵌于插件 ${u.source}`}>插件内嵌</span>
                          )}
                        </div>
                        <div className="m-cell m-ver">{u.version || "—"}</div>
                        <div className="m-cell m-time">{fmtMtime(u.mtime_ms)}</div>
                        <div className="m-cell m-gap" />
                        {visibleAgents.map((a) => (
                          <div className="m-cell m-icon-toggle readonly" key={a.key}>
                            <span className="unmanaged-dash">—</span>
                          </div>
                        ))}
                        <div className="m-cell m-cell-action">
                          <button
                            className="btn btn-ghost btn-adopt"
                            title="收编进 ~/.agents/skills 纳管源"
                            onClick={(e) => {
                              e.stopPropagation();
                              const exists = skills.some((s) => s.id === u.name);
                              if (exists) {
                                setConflictMode("move");
                                setConflictTarget(u);
                              } else {
                                setAdoptMode("move");
                                setAdoptTarget(u);
                              }
                            }}
                          >
                            <HardDriveDownload size={13} />
                            纳管
                          </button>
                        </div>
                        <div className="m-cell m-fill" />
                      </div>
                    )})}
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}

      <SkillDrawer skill={drawerSkill} onClose={() => setDrawerSkill(null)} />

      <ConfirmDialog
        open={!!adoptTarget}
        title={`纳管技能「${adoptTarget?.name ?? ""}」`}
        confirmText={adopting ? "纳管中…" : "纳管"}
        onConfirm={confirmAdopt}
        onCancel={() => !adopting && setAdoptTarget(null)}
        message={
          <>
            <p>
              将复制 <code>{adoptTarget?.path}</code> 到{" "}
              <code>~/.agents/skills/{adoptTarget?.name}</code>，之后即可在矩阵中统一分发。
            </p>
            <div className="adopt-mode-group">
              <label>
                <input
                  type="radio"
                  name="adopt-mode"
                  checked={adoptMode === "move"}
                  onChange={() => setAdoptMode("move")}
                />
                <span>接管（推荐）：复制后原位置替换为链接，原目录自动备份</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="adopt-mode"
                  checked={adoptMode === "copy"}
                  onChange={() => setAdoptMode("copy")}
                />
                <span>仅复制：原位置保持不动（两份副本独立存在）</span>
              </label>
            </div>
          </>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        danger
        title={`删除 ${selectedManaged.length} 项技能`}
        confirmText={deleting ? "删除中…" : "删除"}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteOpen(false)}
        message={
          <>
            <p>
              将删除：
              {selectedManaged.slice(0, 6).map((s) => `「${s.name}」`).join("、")}
              {selectedManaged.length > 6 && ` 等 ${selectedManaged.length} 项`}
            </p>
            <p>
              目录会移入 <code>~/.skillink/.trash</code> 回收区（可手动恢复）；各 Agent
              中指向它们的链接会一并清理，copy 模式产生的副本不受影响。
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={batchAdoptOpen}
        title={`批量纳管 ${selectedUnmanaged.length} 项技能`}
        confirmText={batchAdopting ? "纳管中…" : "纳管"}
        onConfirm={confirmBatchAdopt}
        onCancel={() => !batchAdopting && setBatchAdoptOpen(false)}
        message={
          <>
            <p>
              将把勾选的 {selectedUnmanaged.length} 项未纳管技能复制进{" "}
              <code>~/.agents/skills</code>。
            </p>
            <p>
              若纳管源中已存在同名技能，将自动<strong>合并覆盖</strong>
              （旧目录先备份到回收区，与单行「合并覆盖」一致）。
            </p>
            <div className="adopt-mode-group">
              <label>
                <input
                  type="radio"
                  name="batch-adopt-mode"
                  checked={batchAdoptMode === "move"}
                  onChange={() => setBatchAdoptMode("move")}
                />
                <span>接管（推荐）：复制后原位置替换为链接，原目录自动备份</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="batch-adopt-mode"
                  checked={batchAdoptMode === "copy"}
                  onChange={() => setBatchAdoptMode("copy")}
                />
                <span>仅复制：原位置保持不动（两份副本独立存在）</span>
              </label>
            </div>
          </>
        }
      />

      <ConfirmDialog
        open={conflictTarget !== null}
        danger
        title={`同名技能已存在`}
        confirmText={conflicting ? "合并中…" : "合并覆盖"}
        onConfirm={confirmConflictAdopt}
        onCancel={() => !conflicting && setConflictTarget(null)}
        message={
          <>
            <p>
              已纳管技能中已存在同名技能「<b>{conflictTarget?.name}</b>」。
            </p>
            <p>
              确认要用新版本合并覆盖旧版本吗？旧版本将自动备份到{" "}
              <code>~/.skillink/backups/adopted</code>。
            </p>
            <div className="adopt-mode-group">
              <label>
                <input
                  type="radio"
                  name="conflict-mode"
                  checked={conflictMode === "move"}
                  onChange={() => setConflictMode("move")}
                />
                <span>接管（推荐）：复制后原位置替换为链接，原目录自动备份</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="conflict-mode"
                  checked={conflictMode === "copy"}
                  onChange={() => setConflictMode("copy")}
                />
                <span>仅复制：原位置保持不动（两份副本独立存在）</span>
              </label>
            </div>
          </>
        }
      />
    </div>
  );
}

/** 平台短名：表头列宽有限，长名做缩写，完整名在 title 中 */
function shortAgentName(displayName: string): string {
  return displayName
    .replace("GitHub Copilot", "Copilot")
    .replace("Claude Code", "Claude")
    .replace(" (旧版)", "·旧");
}

function AgentIconHeader({
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
      className={`m-cell m-agent-icon ${agent.detected ? "" : "missing"}`}
      title={`${agent.display_name} (${agent.key})\n${agent.skills_dir}\n${
        agent.detected ? "已安装" : "未安装"
      } · ${linked}/${total}`}
    >
      <AgentBrandIcon agentKey={agent.key} linked={agent.detected} size={17} />
      <span className="agent-col-short">{shortAgentName(agent.display_name)}</span>
    </div>
  );
}
