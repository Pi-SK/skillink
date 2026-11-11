import { useEffect, useMemo, useState } from "react";
import {
  Package,
  Puzzle,
  Boxes,
  HardDriveDownload,
  CheckSquare,
  Square,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { EmptyState } from "../components/EmptyState";
import { MatrixSkeleton } from "../components/Skeleton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Drawer } from "../components/Drawer";
import {
  getUnmanaged,
  adoptPlugin,
  deletePlugin,
  getPluginDetail,
  openPluginFolder,
} from "../api";
import { isTauri } from "../mock";
import { fmtDateMs } from "../util";
import type { AgentStatus, PluginInfo, PluginDetail, UnmanagedItem } from "../types";

/** 插件页：卡片网格（多选删除 + 详情抽屉）+ 未纳管区（批量/一键纳管） */
export function PluginsPage() {
  const { agents, plugins, pluginMatrix, loading, toggling, togglePlugin, reload } = useData();
  const { push } = useToast();
  const [unmanaged, setUnmanaged] = useState<UnmanagedItem[]>([]);
  const [adoptTarget, setAdoptTarget] = useState<UnmanagedItem | null>(null);
  const [adoptMode, setAdoptMode] = useState<"move" | "copy">("move");
  const [adopting, setAdopting] = useState(false);
  // 同名冲突
  const [conflictTarget, setConflictTarget] = useState<UnmanagedItem | null>(null);
  const [conflictMode, setConflictMode] = useState<"move" | "copy">("move");
  const [conflicting, setConflicting] = useState(false);
  // 单个删除
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 批量纳管（未纳管插件）
  const [selectedUnmanaged, setSelectedUnmanaged] = useState<Set<string>>(new Set());
  const [batchAdoptOpen, setBatchAdoptOpen] = useState(false);
  const [batchAdoptMode, setBatchAdoptMode] = useState<"move" | "copy">("move");
  const [batchAdopting, setBatchAdopting] = useState(false);
  // 详情抽屉
  const [detailName, setDetailName] = useState<string | null>(null);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadUnmanaged = () => {
    getUnmanaged().then(setUnmanaged).catch(() => setUnmanaged([]));
  };

  useEffect(loadUnmanaged, []);

  // 详情数据按需拉取
  useEffect(() => {
    if (!detailName) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getPluginDetail(detailName)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) push(`读取插件详情失败: ${String(e)}`, "error");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailName, push]);

  // 反向发现：各 Agent 目录下非 ~/.agents 链接来的插件（只读）
  const unmanagedPlugins = useMemo(
    () => unmanaged.filter((u) => u.kind === "plugin"),
    [unmanaged]
  );

  const pluginAgents = useMemo(
    () => agents.filter((a) => a.plugins_dir && a.key !== "agents" && !a.ignored),
    [agents]
  );

  const linkedMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of pluginMatrix) m.set(`${c.plugin_name}::${c.agent_key}`, c.linked);
    return m;
  }, [pluginMatrix]);

  const toggleSelectUnmanaged = (path: string) => {
    setSelectedUnmanaged((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const confirmAdopt = async () => {
    if (!adoptTarget) return;
    setAdopting(true);
    try {
      await adoptPlugin(adoptTarget.path, adoptMode);
      push(`已纳管插件「${adoptTarget.name}」`, "success");
      setAdoptTarget(null);
      await reload();
      loadUnmanaged();
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
      await adoptPlugin(conflictTarget.path, conflictMode, true);
      push(`已合并覆盖插件「${conflictTarget.name}」`, "success");
      setConflictTarget(null);
      await reload();
      loadUnmanaged();
    } catch (e) {
      push(`合并失败: ${String(e)}`, "error");
    } finally {
      setConflicting(false);
    }
  };

  const confirmBatchAdopt = async () => {
    const items = unmanagedPlugins.filter((u) => selectedUnmanaged.has(u.path));
    if (items.length === 0) return;
    setBatchAdopting(true);
    let ok = 0;
    let fail = 0;
    for (const item of items) {
      try {
        await adoptPlugin(item.path, batchAdoptMode);
        ok++;
      } catch {
        fail++;
      }
    }
    push(
      `批量纳管完成：成功 ${ok} 项${fail > 0 ? `，失败 ${fail} 项` : ""}`,
      fail === 0 ? "success" : "info"
    );
    setSelectedUnmanaged(new Set());
    setBatchAdoptOpen(false);
    setBatchAdopting(false);
    await reload();
    loadUnmanaged();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await deletePlugin(deleteTarget);
      push(
        `已删除插件「${deleteTarget}」${r.removed_links > 0 ? `，清理 ${r.removed_links} 个链接` : ""}（已移入回收区）`,
        "success"
      );
    } catch (e) {
      push(`删除失败: ${String(e)}`, "error");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
      await reload();
      loadUnmanaged();
    }
  };

  const openDetail = (name: string) => setDetailName(name);

  const handleOpenFolder = () => {
    if (!detailName) return;
    if (!isTauri) {
      push("仅在桌面端可用", "info");
      return;
    }
    openPluginFolder(detailName).catch((e) => push(String(e), "error"));
  };

  if (loading) return <MatrixSkeleton rows={5} />;

  if (plugins.length === 0 && unmanagedPlugins.length === 0) {
    return (
      <div className="page">
        <EmptyState
          icon={Puzzle}
          title="尚未检测到任何插件"
          description="将插件文件夹（含 .claude-plugin/plugin.json 或 commands/、skills/ 等标准结构）放到 ~/.agents/plugins 目录后刷新。"
          action={{ label: "刷新", onClick: () => { reload(); loadUnmanaged(); } }}
        />
      </div>
    );
  }

  const allUnmanagedSelected =
    unmanagedPlugins.length > 0 && unmanagedPlugins.every((u) => selectedUnmanaged.has(u.path));

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="toolbar-spacer" />
        <span className="toolbar-count">
          {plugins.length} 个插件 · {pluginAgents.filter((a) => a.detected).length} 个支持插件的 Agent
        </span>

        {(selectedUnmanaged.size > 0) && (
          <div className="selection-bar">
            <span className="selection-count">
              已选 {selectedUnmanaged.size} 项
            </span>
            {selectedUnmanaged.size > 0 && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setBatchAdoptMode("move");
                  setBatchAdoptOpen(true);
                }}
              >
                <HardDriveDownload size={13} />
                纳管 ({selectedUnmanaged.size})
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setSelectedUnmanaged(new Set());
              }}
            >
              清除选择
            </button>
          </div>
        )}
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
            onOpenDetail={() => openDetail(p.name)}
            onDelete={() => { setDeleteTarget(p.name); setDeleteOpen(true); }}
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
            <span className="unmanaged-hint">各 Agent 目录下非 ~/.agents 链接来的插件</span>
            <div className="toolbar-spacer" />
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                setSelectedUnmanaged(
                  allUnmanagedSelected
                    ? new Set()
                    : new Set(unmanagedPlugins.map((u) => u.path))
                )
              }
            >
              {allUnmanagedSelected ? <CheckSquare size={13} /> : <Square size={13} />}
              全选
            </button>
            <button
              className="btn btn-sm"
              title="一键纳管全部未纳管插件"
              onClick={() => {
                setSelectedUnmanaged(new Set(unmanagedPlugins.map((u) => u.path)));
                setBatchAdoptMode("move");
                setBatchAdoptOpen(true);
              }}
            >
              <HardDriveDownload size={13} />
              一键全部纳管
            </button>
          </div>
          <div className="unmanaged-rows">
            {unmanagedPlugins.map((u) => {
              const agent = agents.find((a) => a.key === u.agent_key);
              const checked = selectedUnmanaged.has(u.path);
              return (
                <div className="unmanaged-row" key={u.path} title={u.path}>
                  <span
                    className={`unmanaged-chk ${checked ? "on" : ""}`}
                    title={checked ? "取消选择" : "选中批量纳管"}
                    onClick={() => toggleSelectUnmanaged(u.path)}
                  >
                    {checked ? <CheckSquare size={14} /> : <Square size={14} />}
                  </span>
                  <Puzzle size={14} className="group-icon-local" />
                  <span className="unmanaged-name">{u.name}</span>
                  <span className="tag tag-local">本地</span>
                  <span className="unmanaged-agent">{agent?.display_name ?? u.agent_key}</span>
                  {u.version && <span className="tag tag-neutral">v{u.version}</span>}
                  <span className="unmanaged-time">{fmtDateMs(u.mtime_ms)}</span>
                  <div className="toolbar-spacer" />
                  <span className="unmanaged-path">{u.link_target ?? u.path}</span>
                  <button
                    className="btn btn-ghost btn-adopt"
                    title="收编进 ~/.agents/plugins 纳管源"
                    onClick={() => {
                      const exists = plugins.some((p) => p.name === u.name);
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
              );
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!adoptTarget}
        title={`纳管插件「${adoptTarget?.name ?? ""}」`}
        confirmText={adopting ? "纳管中…" : "纳管"}
        onConfirm={confirmAdopt}
        onCancel={() => !adopting && setAdoptTarget(null)}
        message={
          <>
            <p>
              将复制 <code>{adoptTarget?.path}</code> 到{" "}
              <code>~/.agents/plugins/{adoptTarget?.name}</code>，纳管后可同步到各 Agent。
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
        title={`删除插件「${deleteTarget ?? ""}」`}
        confirmText={deleting ? "删除中…" : "删除"}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteOpen(false)}
        message={
          <>
            <p>确定要删除插件「{deleteTarget}」吗？</p>
            <p>
              目录会移入 <code>~/.skillink/.trash</code> 回收区（可手动恢复）；各 Agent
              中指向插件本体与其内嵌技能的链接会一并清理。
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={batchAdoptOpen}
        title={`批量纳管 ${selectedUnmanaged.size} 个插件`}
        confirmText={batchAdopting ? "纳管中…" : "纳管"}
        onConfirm={confirmBatchAdopt}
        onCancel={() => !batchAdopting && setBatchAdoptOpen(false)}
        message={
          <>
            <p>
              将把勾选的 {selectedUnmanaged.size} 个未纳管插件复制进{" "}
              <code>~/.agents/plugins</code>，纳管后可统一同步到各 Agent。
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
        title={`同名插件已存在`}
        confirmText={conflicting ? "合并中…" : "合并覆盖"}
        onConfirm={confirmConflictAdopt}
        onCancel={() => !conflicting && setConflictTarget(null)}
        message={
          <>
            <p>
              已纳管插件中已存在同名插件「<b>{conflictTarget?.name}</b>」。
            </p>
            <p>
              确认要用新版本合并覆盖旧版本吗？旧版本将自动备份到{" "}
              <code>~/.skillink/backups/adopted</code>。
            </p>
            <div className="adopt-mode-group">
              <label>
                <input
                  type="radio"
                  name="conflict-plugin-mode"
                  checked={conflictMode === "move"}
                  onChange={() => setConflictMode("move")}
                />
                <span>接管（推荐）：复制后原位置替换为链接，原目录自动备份</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="conflict-plugin-mode"
                  checked={conflictMode === "copy"}
                  onChange={() => setConflictMode("copy")}
                />
                <span>仅复制：原位置保持不动（两份副本独立存在）</span>
              </label>
            </div>
          </>
        }
      />

      <Drawer
        open={detailName !== null}
        onClose={() => setDetailName(null)}
        title={
          <span className="drawer-skill-title">
            <Package size={15} className="group-icon-plugin" />
            {detailName ?? ""}
          </span>
        }
        footer={
          <button className="btn" onClick={handleOpenFolder}>
            <FolderOpen size={14} />
            打开源目录
          </button>
        }
      >
        {detailLoading ? (
          <div className="docs-loading">
            <Loader2 size={15} className="spin" /> 读取中…
          </div>
        ) : detail ? (
          <>
            <div className="skill-drawer-meta">
              <div className="meta-row">
                <span className="meta-label">版本</span>
                <span className="meta-value">{detail.version || "—"}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">修改时间</span>
                <span className="meta-value">{fmtDateMs(detail.mtime_ms)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">简介</span>
                <span className="meta-value">{detail.description || "暂无描述"}</span>
              </div>
            </div>

            <div className="skill-drawer-section">
              <div className="section-label">内置技能（{detail.skills.length}）</div>
              {detail.skills.length === 0 ? (
                <p className="section-hint">该插件不含内嵌技能</p>
              ) : (
                <div className="plugin-detail-skills">
                  {detail.skills.map((s) => (
                    <div className="plugin-detail-skill" key={s.id}>
                      <div className="plugin-detail-skill-head">
                        <span className="skill-name-text">{s.name}</span>
                        {s.version && <span className="tag tag-neutral">v{s.version}</span>}
                      </div>
                      {s.description && (
                        <div className="plugin-detail-skill-desc">{s.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function PluginCard({
  plugin,
  agents,
  linkedMap,
  toggling,
  onOpenDetail,
  onDelete,
  onToggle,
}: {
  plugin: PluginInfo;
  agents: AgentStatus[];
  linkedMap: Map<string, boolean>;
  toggling: Set<string>;
  onOpenDetail: () => void;
  onDelete: () => void;
  onToggle: (agentKey: string, enable: boolean) => void;
}) {
  const linkedCount = agents.filter((a) => linkedMap.get(`${plugin.name}::${a.key}`)).length;

  return (
    <div
      className="plugin-card"
      role="button"
      tabIndex={0}
      title="查看套件详情"
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
    >
      <div
        className="plugin-card-delete"
        title="删除此插件"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <X size={14} />
      </div>
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
        {plugin.version && <span className="tag tag-neutral">v{plugin.version}</span>}
        <span className="tag tag-neutral" title={`最后修改：${fmtDateMs(plugin.mtime_ms)}`}>
          {fmtDateMs(plugin.mtime_ms)}
        </span>
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
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(agent.key, !linked);
                }}
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
