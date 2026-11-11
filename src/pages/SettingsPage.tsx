import { useEffect, useState } from "react";
import {
  FolderOpen,
  Info,
  Stethoscope,
  TriangleAlert,
  Clock3,
  Unlink,
  CircleCheck,
  Link2,
  Copy,
  Plus,
  Wrench,
  CheckSquare,
  Square,
  EyeOff,
} from "lucide-react";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { openAgentsJson, getIssues, setAgentSyncMode, setAgentIgnored, saveCustomAgent, repairIssue } from "../api";
import { isTauri } from "../mock";
import { MatrixSkeleton } from "../components/Skeleton";
import { AgentBrandIcon } from "../AgentIcon";
import type { Issue } from "../types";

const ISSUE_META: Record<string, { label: string; icon: typeof Unlink }> = {
  conflict: { label: "冲突", icon: TriangleAlert },
  name_collision: { label: "同名", icon: Info },
  drift: { label: "漂移", icon: Clock3 },
  broken_link: { label: "断链", icon: Unlink },
};

/** 设置页：Agent 注册表概览 + 健康检查 + 配置入口（应用内编辑为 P2） */
export function SettingsPage() {
  const { agents, loading, reload } = useData();
  const { push } = useToast();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [togglingSync, setTogglingSync] = useState<Set<string>>(new Set());
  const [togglingIgnore, setTogglingIgnore] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [formEditKey, setFormEditKey] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Set<number>>(new Set());
  const [repairing, setRepairing] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    key: "",
    display_name: "",
    skills_dir: "~/",
    plugins_dir: "",
    detect_dir: "~/",
    sync_mode: "auto",
  });

  useEffect(() => {
    getIssues().then(setIssues).catch(() => setIssues([]));
  }, []);

  if (loading) return <MatrixSkeleton rows={6} />;

  // 注册表展示与计数：排除 .agents 源目录（非同步目标）
  const registryAgents = agents.filter((a) => a.key !== "agents");
  const detected = registryAgents.filter((a) => a.detected).length;

  const handleSyncMode = async (agentKey: string, next: string) => {
    setTogglingSync((prev) => new Set(prev).add(agentKey));
    try {
      await setAgentSyncMode(agentKey, next);
      push(
        next === "auto" ? `「${agentKey}」已切换为软链接方式` : `「${agentKey}」已切换为文件复制方式`,
        "success"
      );
      await reload();
    } catch (e) {
      push(`切换失败: ${String(e)}`, "error");
    } finally {
      setTogglingSync((prev) => {
        const next = new Set(prev);
        next.delete(agentKey);
        return next;
      });
    }
  };

  const handleIgnore = async (agentKey: string, ignored: boolean) => {
    setTogglingIgnore((prev) => new Set(prev).add(agentKey));
    try {
      await setAgentIgnored(agentKey, ignored);
      push(
        ignored ? `已忽略「${agentKey}」平台（不再同步）` : `已取消忽略「${agentKey}」平台`,
        "success"
      );
      await reload();
    } catch (e) {
      push(`操作失败: ${String(e)}`, "error");
    } finally {
      setTogglingIgnore((prev) => {
        const next = new Set(prev);
        next.delete(agentKey);
        return next;
      });
    }
  };

  const handleSaveCustomAgent = async () => {
    if (!isTauri) {
      push("自定义 Agent 仅在桌面端可用", "info");
      return;
    }
    if (!form.key.trim() || !form.display_name.trim()) {
      push("key 和显示名称不能为空", "error");
      return;
    }
    setFormSaving(true);
    try {
      await saveCustomAgent({
        key: form.key.trim(),
        display_name: form.display_name.trim(),
        skills_dir: form.skills_dir.trim(),
        plugins_dir: form.plugins_dir.trim() || undefined,
        detect_dir: form.detect_dir.trim(),
        sync_mode: form.sync_mode,
      });
      push(formEditKey ? `已更新 Agent「${form.key}」` : `已添加自定义 Agent「${form.key}」`, "success");
      setShowForm(false);
      setFormEditKey(null);
      await reload();
    } catch (e) {
      push(`保存失败: ${String(e)}`, "error");
    } finally {
      setFormSaving(false);
    }
  };

  const openEditForm = (agent: typeof agents[0]) => {
    setForm({
      key: agent.key,
      display_name: agent.display_name,
      skills_dir: agent.skills_dir,
      plugins_dir: agent.plugins_dir || "",
      detect_dir: (agent as any).detect_dir || "~/",
      sync_mode: agent.sync_mode,
    });
    setFormEditKey(agent.key);
    setShowForm(true);
  };

  const openNewForm = () => {
    setForm({ key: "", display_name: "", skills_dir: "~/", plugins_dir: "", detect_dir: "~/", sync_mode: "auto" });
    setFormEditKey(null);
    setShowForm(true);
  };

  const handleRepair = async (index: number) => {
    const issue = issues[index];
    if (!issue) return;
    if (issue.kind === "conflict" || issue.kind === "name_collision") {
      push(issue.kind === "name_collision"
        ? "同名技能已自动区分目标目录，无需手动处理"
        : "冲突问题需手动处理：请删除或重命名重复的技能来源", "info");
      return;
    }
    setRepairing((prev) => new Set(prev).add(index));
    try {
      await repairIssue(issue);
      push(`已修复：${issue.message}`, "success");
      await reload();
      const updated = await getIssues();
      setIssues(updated);
    } catch (e) {
      push(`修复失败: ${String(e)}`, "error");
    } finally {
      setRepairing((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const handleRepairAll = async () => {
    // 有选中项则修复选中项，否则修复全部可修复项
    const isRepairable = (issue: Issue) => issue.kind !== "conflict" && issue.kind !== "name_collision" && issue.agent_key && issue.skill_id;
    const toRepair = selectedIssues.size > 0
      ? [...selectedIssues].filter((i) => isRepairable(issues[i]!))
      : issues.reduce<number[]>((acc, issue, i) => {
          if (isRepairable(issue)) acc.push(i);
          return acc;
        }, []);
    if (toRepair.length === 0) {
      push("没有可修复的问题", "info");
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const idx of toRepair) {
      setRepairing((prev) => new Set(prev).add(idx));
      try {
        await repairIssue(issues[idx]);
        ok++;
      } catch {
        fail++;
      }
    }
    setRepairing(new Set());
    push(`批量修复完成：成功 ${ok} 项${fail > 0 ? `，失败 ${fail} 项` : ""}`, fail === 0 ? "success" : "info");
    setSelectedIssues(new Set());
    await reload();
    const updated = await getIssues();
    setIssues(updated);
  };

  const toggleIssueSelect = (i: number) => {
    setSelectedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAllIssues = () => {
    const repairable = issues.reduce<number[]>((acc, issue, i) => {
      if (issue.kind !== "conflict" && issue.kind !== "name_collision") acc.push(i);
      return acc;
    }, []);
    setSelectedIssues((prev) => {
      const allSelected = repairable.length > 0 && repairable.every((i) => prev.has(i));
      const next = new Set(prev);
      repairable.forEach((i) => (allSelected ? next.delete(i) : next.add(i)));
      return next;
    });
  };

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="toolbar-spacer" />
        <span className="toolbar-count">
          已检测 {detected}/{registryAgents.length} 个 Agent
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
        <button className="btn btn-primary" onClick={openNewForm}>
          <Plus size={14} />
          添加自定义 Agent
        </button>
      </div>

      <div className="settings-section">
        <h3 className="section-title">Agent 注册表</h3>
        <p className="section-hint">
          内置 {registryAgents.length} 个同步目标（不含 .agents 源目录）；在 ~/.skillink/agents.json
          中按 key 覆盖或新增自定义 Agent（需包含 key / display_name / skills_dir / detect_dir 字段）。
        </p>
        <div className="agent-table">
          {registryAgents.map((a) => {
            return (
            <div className="agent-row" key={a.key}>
              <span className={`agent-avatar-sm agent-logo-cell ${a.detected ? "" : "dim"}`}>
                <AgentBrandIcon agentKey={a.key} linked={a.detected} size={18} />
              </span>
              <button className="agent-row-name-btn" onClick={() => openEditForm(a)} title="点击编辑">
                {a.display_name}
              </button>
              <span className="agent-row-key">{a.key}</span>
              {a.plugins_dir && <span className="tag tag-neutral">插件</span>}
              <span className="agent-row-path" title={a.skills_dir}>
                {a.skills_dir}
              </span>
              <div className="toolbar-spacer" />
              <span className="sync-mode-row">
                <button
                  className={`btn btn-sm sync-mode-btn ${a.sync_mode === "auto" ? "active" : ""}`}
                  disabled={togglingSync.has(a.key)}
                  title="软链接（junction）：不占空间，实时同步"
                  onClick={() => a.sync_mode !== "auto" && handleSyncMode(a.key, "auto")}
                >
                  <Link2 size={12} />
                  软链接
                </button>
                <button
                  className={`btn btn-sm sync-mode-btn ${a.sync_mode === "copy" ? "active" : ""}`}
                  disabled={togglingSync.has(a.key)}
                  title="文件复制：复制到 Agent 目录，可脱机使用"
                  onClick={() => a.sync_mode !== "copy" && handleSyncMode(a.key, "copy")}
                >
                  <Copy size={12} />
                  复制
                </button>
              </span>
              <button
                className={`btn btn-sm ignore-agent-btn ${a.ignored ? "active" : ""}`}
                disabled={togglingIgnore.has(a.key)}
                title={a.ignored ? "点击取消忽略，恢复同步" : "忽略此平台（不同步，技能/插件页自动折叠）"}
                onClick={() => handleIgnore(a.key, !a.ignored)}
              >
                <EyeOff size={12} />
                {a.ignored ? "已忽略" : "忽略"}
              </button>
            </div>
          )})}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="section-title">
          <Stethoscope size={14} className="inline-icon" />
          健康检查
        </h3>
        <p className="section-hint">
          检测同名技能冲突（conflict）、copy 副本落后（drift）与断链（broken_link）。
        </p>
        {issues.length === 0 ? (
          <div className="issue-ok">
            <CircleCheck size={14} />
            未发现问题，所有链接状态正常
          </div>
        ) : (
          <>
            {selectedIssues.size > 0 && (
              <div className="selection-bar" style={{ marginBottom: 8 }}>
                <span className="selection-count">已选 {selectedIssues.size} 项</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setSelectedIssues(new Set())}>
                  清除选择
                </button>
              </div>
            )}
            <div className="issue-list">
              <div className="issue-header-row">
                <div
                  className="issue-chk"
                  onClick={toggleAllIssues}
                  title="全选可修复项（不含冲突和同名提示）"
                >
                  {issues.some((is, i) => is.kind !== "conflict" && is.kind !== "name_collision" && !selectedIssues.has(i))
                    ? <Square size={14} />
                    : <CheckSquare size={14} />
                  }
                </div>
                <span className="issue-header-label">全选可修复</span>
                <div className="toolbar-spacer" />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleRepairAll}
                >
                  <Wrench size={13} />
                  {selectedIssues.size > 0 ? `修复已选 (${selectedIssues.size})` : "一键修复全部"}
                </button>
              </div>
              {issues.map((issue, i) => {
                const meta = ISSUE_META[issue.kind] ?? ISSUE_META.conflict;
                const Icon = meta.icon;
                const repairable = issue.kind !== "conflict" && issue.kind !== "name_collision" && issue.agent_key && issue.skill_id;
                const busy = repairing.has(i);
                return (
                  <div className="issue-item" key={i}>
                    {repairable && (
                      <div
                        className={`issue-chk ${selectedIssues.has(i) ? "on" : ""}`}
                        onClick={() => toggleIssueSelect(i)}
                      >
                        {selectedIssues.has(i) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </div>
                    )}
                    <Icon size={14} className={`issue-icon ${issue.kind}`} />
                    <span className={`tag issue-kind issue-kind-${issue.kind}`}>
                      {meta.label}
                    </span>
                    <span className="issue-msg">{issue.message}</span>
                    <div className="toolbar-spacer" />
                    {repairable && (
                      <button
                        className="btn btn-sm issue-repair-btn"
                        onClick={() => handleRepair(i)}
                        disabled={busy}
                      >
                        <Wrench size={11} />
                        {busy ? "修复中…" : "修复"}
                      </button>
                    )}
                    {issue.kind === "conflict" && (
                      <span className="issue-manual-hint">需手动处理</span>
                    )}
                    {issue.kind === "name_collision" && (
                      <span className="issue-manual-hint" style={{ color: "var(--text-faint)" }}>已自动区分</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3 className="section-title">
          <Info size={14} className="inline-icon" />
          关于
        </h3>
        <p className="section-hint">
          Skillink v1.2.1 — 跨平台 AI Agent 资产管理器。 通过 NTFS
          junction（目录链接）在多个 Agent 之间同步 Skills 与
          Plugins，源数据始终保存在 ~/.agents/ 下，不复制、不搬迁。
        </p>
      </div>

      {/* 自定义 Agent 表单弹窗 */}
      {showForm && (
        <div className="dialog-overlay" onMouseDown={() => setShowForm(false)}>
          <div className="dialog agent-form-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dialog-title">
              {formEditKey ? `编辑 Agent「${formEditKey}」` : "添加自定义 Agent"}
            </div>
            <div className="agent-form">
              <label className="form-label">
                Key <span className="form-required">*</span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="例如 my-agent"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  disabled={!!formEditKey}
                />
              </label>
              <label className="form-label">
                显示名称 <span className="form-required">*</span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="例如 My Agent"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                />
              </label>
              <label className="form-label">
                Skills 目录
                <input
                  type="text"
                  className="form-input"
                  placeholder="~/.my-agent/skills"
                  value={form.skills_dir}
                  onChange={(e) => setForm({ ...form, skills_dir: e.target.value })}
                />
              </label>
              <label className="form-label">
                Plugins 目录（可选）
                <input
                  type="text"
                  className="form-input"
                  placeholder="留空表示不支持插件同步"
                  value={form.plugins_dir}
                  onChange={(e) => setForm({ ...form, plugins_dir: e.target.value })}
                />
              </label>
              <label className="form-label">
                检测目录
                <input
                  type="text"
                  className="form-input"
                  placeholder="~/.my-agent"
                  value={form.detect_dir}
                  onChange={(e) => setForm({ ...form, detect_dir: e.target.value })}
                />
              </label>
              <label className="form-label">
                同步方式
                <div className="form-radio-group">
                  <label className="form-radio">
                    <input
                      type="radio"
                      name="form-sync"
                      checked={form.sync_mode === "auto"}
                      onChange={() => setForm({ ...form, sync_mode: "auto" })}
                    />
                    软链接（junction）
                  </label>
                  <label className="form-radio">
                    <input
                      type="radio"
                      name="form-sync"
                      checked={form.sync_mode === "copy"}
                      onChange={() => setForm({ ...form, sync_mode: "copy" })}
                    />
                    文件复制
                  </label>
                </div>
              </label>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSaveCustomAgent} disabled={formSaving}>
                {formSaving ? "保存中…" : formEditKey ? "更新" : "添加"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
