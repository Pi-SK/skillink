import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Save,
  Trash2,
  Scissors,
  Send,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { useToast } from "../components/Toast";
import { useNavigationGuard } from "../components/NavigationGuard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { isTauri } from "../mock";
import type { Snippet, InstructionDoc, SyncTarget, SyncPreviewItem } from "../types";
import * as api from "../api";

const cmTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent" },
    ".cm-content": {
      fontFamily: "'Cascadia Code', Consolas, 'Microsoft YaHei', monospace",
      padding: "12px 4px",
      userSelect: "text",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "1px solid var(--border-soft)",
      color: "var(--text-faint)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(91,141,239,0.05)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(91,141,239,0.18) !important",
    },
  },
  { dark: true }
);

export function SnippetsTab() {
  const { push } = useToast();
  const { guard, setDirty } = useNavigationGuard();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSnippets = useCallback(async () => {
    try {
      const list = await api.getSnippets();
      setSnippets(list);
      return list;
    } catch (e) {
      push(`加载片段失败: ${String(e)}`, "error");
      return [];
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  const selected = useMemo(
    () => snippets.find((s) => s.id === selectedId) ?? null,
    [snippets, selectedId]
  );

  const openSnippet = (s: Snippet) => {
    setSelectedId(s.id);
    setIsNew(false);
    setId(s.id);
    setName(s.name);
    setContent(s.content);
    setOriginalContent(s.content);
    setOriginalName(s.name);
  };

  const newSnippet = () => {
    setSelectedId(null);
    setIsNew(true);
    setId("");
    setName("");
    setContent("");
    setOriginalContent("");
    setOriginalName("");
  };

  const dirty =
    content !== originalContent ||
    name.trim() !== originalName.trim() ||
    (isNew && (id !== "" || name !== "" || content !== ""));

  // 上报脏状态给全局守卫
  useEffect(() => {
    setDirty("snippets", dirty);
    return () => setDirty("snippets", false);
  }, [dirty, setDirty]);

  const save = async (): Promise<Snippet | null> => {
    const finalId = id.trim();
    if (!finalId) {
      push("请填写片段 id（小写字母、数字、- 或 _）", "error");
      return null;
    }
    try {
      const saved = await api.saveSnippet(finalId, name.trim(), content);
      push(`已保存片段「${saved.name}」`, "success");
      const list = await loadSnippets();
      setSelectedId(saved.id);
      setIsNew(false);
      setId(saved.id);
      setName(saved.name);
      setOriginalContent(saved.content);
      setOriginalName(saved.name);
      return list.find((s) => s.id === saved.id) ?? saved;
    } catch (e) {
      push(`保存失败: ${String(e)}`, "error");
      return null;
    }
  };

  const doDelete = async () => {
    if (!selectedId) return;
    try {
      await api.deleteSnippet(selectedId);
      push("片段已删除（移入 ~/.skillink/.trash）", "success");
      setConfirmDelete(false);
      newSnippet();
      await loadSnippets();
    } catch (e) {
      push(`删除失败: ${String(e)}`, "error");
    }
  };

  const startSync = async () => {
    if (!isTauri) {
      push("分发同步仅在桌面端可用", "info");
      return;
    }
    // 同步前先保存，保证分发的是落盘内容
    const saved = isNew ? await save() : dirty ? await save() : selected;
    if (!saved) return;
    setSyncOpen(true);
  };

  return (
    <div className="snippets-layout">
      <div className="docs-col snippets-list">
        <button className="btn btn-primary snippet-new-btn" onClick={() => guard(newSnippet)}>
          <Plus size={14} />
          新建片段
        </button>
        {loading && <div className="docs-loading">加载中…</div>}
        {!loading && snippets.length === 0 && (
          <div className="backup-empty">
            还没有共享片段。新建一条规则，一键分发到所有 Agent。
          </div>
        )}
        {snippets.map((s) => (
          <button
            key={s.id}
            className={`snippet-item ${selectedId === s.id && !isNew ? "active" : ""}`}
            onClick={() => guard(() => openSnippet(s))}
          >
            <Scissors size={13} />
            <div className="snippet-item-info">
              <div className="snippet-item-name">{s.name}</div>
              <div className="snippet-item-id">{s.id}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="snippet-editor">
        {!isNew && !selected ? (
          <div className="snippet-empty-hint">
            <Scissors size={22} strokeWidth={1.5} />
            <div>选择左侧片段编辑，或新建一个共享规则片段</div>
            <div className="dim-hint">
              片段以受管标记块写入各 Agent 的指令文档，不覆盖手写内容
            </div>
          </div>
        ) : (
          <>
            <div className="editor-toolbar">
              <input
                type="text"
                className="snippet-id-input"
                placeholder="id（如 coding-rules）"
                value={id}
                disabled={!isNew}
                onChange={(e) => setId(e.target.value.toLowerCase())}
                title={isNew ? "仅小写字母、数字、- 和 _" : "id 创建后不可修改"}
              />
              <input
                type="text"
                className="snippet-name-input"
                placeholder="显示名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {dirty && <span className="dirty-dot" title="有未保存更改" />}
              <div className="toolbar-spacer" />
              {!isNew && selected && (
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} />
                  删除
                </button>
              )}
              <button className="btn" onClick={save} disabled={!dirty && !isNew}>
                <Save size={14} />
                保存
              </button>
              <button
                className="btn btn-primary"
                onClick={startSync}
                disabled={isNew && !content.trim()}
              >
                <Send size={14} />
                分发到 Agents
              </button>
            </div>

            <div className="editor-meta">
              保存位置 ~/.skillink/snippets/{id || "…"}.md · 分发目标为各 Agent 的「指令」类文档
            </div>

            <div className="editor-area">
              <CodeMirror
                value={content}
                onChange={setContent}
                theme={cmTheme}
                extensions={[markdown()]}
                basicSetup={{ foldGutter: false, autocompletion: false }}
              />
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除共享片段"
        message={
          <>
            片段文件将移入 ~/.skillink/.trash（不会永久删除）。
            <br />
            注意：已分发到各 Agent 文档中的同步块不会自动移除，如需移除请使用「分发」中的移除模式。
          </>
        }
        confirmText="删除"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />

      {syncOpen && selectedId && (
        <SyncModal
          snippetId={selectedId}
          onClose={() => setSyncOpen(false)}
        />
      )}
    </div>
  );
}

/** 分发同步弹窗：选目标 → dry-run 预览 → 应用 */
function SyncModal({ snippetId, onClose }: { snippetId: string; onClose: () => void }) {
  const { push } = useToast();
  const [allTargets, setAllTargets] = useState<InstructionDoc[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [removeMode, setRemoveMode] = useState(false);
  const [preview, setPreview] = useState<SyncPreviewItem[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [viewContent, setViewContent] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    api
      .getInstructionDocs()
      .then((docs) => {
        // 分发目标：可编辑的「指令」类文档
        const targets = docs.filter((d) => d.editable && d.role === "指令");
        setAllTargets(targets);
        setChecked(new Set(targets.map((t) => `${t.agent_key}::${t.file_name}`)));
      })
      .catch((e) => push(String(e), "error"));
  }, [push]);

  const selectedTargets: SyncTarget[] = allTargets
    .filter((t) => checked.has(`${t.agent_key}::${t.file_name}`))
    .map((t) => ({ agent_key: t.agent_key, file_name: t.file_name }));

  const runPreview = async () => {
    if (selectedTargets.length === 0) {
      push("请至少选择一个目标文档", "error");
      return;
    }
    setPreviewing(true);
    try {
      const result = await api.previewSnippetSync(snippetId, selectedTargets, removeMode);
      setPreview(result);
    } catch (e) {
      push(`预览失败: ${String(e)}`, "error");
    } finally {
      setPreviewing(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const results = await api.applySnippetSync(snippetId, selectedTargets, removeMode);
      const okCount = results.filter((r) => r.success).length;
      const failCount = results.length - okCount;
      if (failCount === 0) {
        push(`${removeMode ? "移除" : "分发"}完成：${okCount} 个文档成功`, "success");
        onClose();
      } else {
        push(`完成但有 ${failCount} 个失败，请检查`, "error");
        setPreview(null);
      }
    } catch (e) {
      push(`应用失败: ${String(e)}`, "error");
    } finally {
      setApplying(false);
      setConfirmApply(false);
    }
  };

  const stateTag = (state: string) => {
    switch (state) {
      case "synced":
        return <span className="tag tag-linked">已同步</span>;
      case "changed":
        return <span className="tag tag-warn">内容有差异</span>;
      case "no_doc":
        return <span className="tag tag-neutral">文档不存在（将创建）</span>;
      default:
        return <span className="tag tag-neutral">未同步</span>;
    }
  };

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="sync-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="preview-modal-head">
          <span className="preview-modal-title">
            {removeMode ? "移除同步块" : "分发片段"} · {snippetId}
          </span>
          <button className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="sync-modal-body">
          <div className="sync-mode-row">
            <label className="mini-switch-label">
              <input
                type="radio"
                name="syncmode"
                checked={!removeMode}
                onChange={() => {
                  setRemoveMode(false);
                  setPreview(null);
                }}
              />
              写入 / 更新受管块
            </label>
            <label className="mini-switch-label">
              <input
                type="radio"
                name="syncmode"
                checked={removeMode}
                onChange={() => {
                  setRemoveMode(true);
                  setPreview(null);
                }}
              />
              移除受管块
            </label>
            <div className="toolbar-spacer" />
            <button className="btn" onClick={runPreview} disabled={previewing}>
              <Eye size={14} />
              {previewing ? "预览中…" : "预览变更"}
            </button>
          </div>

          <div className="sync-targets">
            {allTargets.map((t) => {
              const key = `${t.agent_key}::${t.file_name}`;
              return (
                <label className="sync-target-item" key={key}>
                  <input
                    type="checkbox"
                    checked={checked.has(key)}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                      setPreview(null);
                    }}
                  />
                  <span className="sync-target-name">
                    {t.agent_key} / {t.file_name}
                  </span>
                  <span className="sync-target-path">~/{t.rel_path}</span>
                </label>
              );
            })}
            {allTargets.length === 0 && (
              <div className="backup-empty">没有可分发的「指令」类文档</div>
            )}
          </div>

          {preview && (
            <div className="sync-preview">
              {preview.map((p) => (
                <div className="sync-preview-item" key={`${p.agent_key}::${p.file_name}`}>
                  <div className="sync-preview-head">
                    {removeMode && !p.doc_exists && p.state === "not_synced" ? (
                      <CheckCircle2 size={13} className="ok-icon" />
                    ) : p.state === "synced" && !removeMode ? (
                      <CheckCircle2 size={13} className="ok-icon" />
                    ) : (
                      <AlertCircle size={13} className="warn-icon" />
                    )}
                    <span>
                      {p.agent_key} / {p.file_name}
                    </span>
                    {stateTag(removeMode ? (p.state === "synced" ? "changed" : p.state) : p.state)}
                    <div className="toolbar-spacer" />
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        setViewContent({
                          title: `${p.agent_key} / ${p.file_name}（应用后完整内容）`,
                          content: p.next_content,
                        })
                      }
                    >
                      查看结果
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="preview-modal-actions">
          <span className="sync-hint">
            写入前自动备份各目标文档 · 仅修改 SKILLMAN 受管块，不碰手写内容
          </span>
          <div className="toolbar-spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className={`btn ${removeMode ? "btn-danger" : "btn-primary"}`}
            disabled={!preview || selectedTargets.length === 0 || applying}
            onClick={() => setConfirmApply(true)}
          >
            <Send size={14} />
            {applying ? "应用中…" : removeMode ? "确认移除" : "确认分发"}
          </button>
        </div>
      </div>

      {viewContent && (
        <div className="preview-modal content-modal" onMouseDown={() => setViewContent(null)}>
          <div className="preview-modal-inner" onMouseDown={(e) => e.stopPropagation()}>
            <div className="preview-modal-head">
              <span className="preview-modal-title">{viewContent.title}</span>
              <button className="btn-icon" onClick={() => setViewContent(null)}>
                <X size={15} />
              </button>
            </div>
            <pre className="content-dump">{viewContent.content}</pre>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmApply}
        title={removeMode ? "确认移除受管块" : "确认分发"}
        message={
          removeMode
            ? `将从 ${selectedTargets.length} 个文档中移除「${snippetId}」受管块（写入前自动备份）。`
            : `将把片段写入 ${selectedTargets.length} 个文档的受管块（写入前自动备份）。`
        }
        confirmText={removeMode ? "移除" : "分发"}
        danger={removeMode}
        onCancel={() => setConfirmApply(false)}
        onConfirm={apply}
      />
    </div>
  );
}
