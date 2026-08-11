import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Save,
  Eye,
  PenLine,
  History,
  SquareArrowOutUpRight,
  FolderSearch,
  Lock,
  Scissors,
  X,
} from "lucide-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { useData } from "../store";
import { useToast } from "../components/Toast";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Markdown } from "../components/Markdown";
import { EmptyState } from "../components/EmptyState";
import { SnippetsTab } from "./SnippetsTab";
import { isTauri } from "../mock";
import { fmtSize, fmtRelTime, fmtTime } from "../util";
import type { InstructionDoc, BackupInfo } from "../types";
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
    ".cm-activeLine": { backgroundColor: "rgba(79,195,247,0.05)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(79,195,247,0.18) !important",
    },
  },
  { dark: true }
);

const ROLE_ORDER = ["指令", "人格", "用户画像", "记忆"];

type DocKey = { agentKey: string; fileName: string };
const keyOf = (k: DocKey) => `${k.agentKey}::${k.fileName}`;

export function DocsPage() {
  const [subTab, setSubTab] = useState<"docs" | "snippets">("docs");

  return (
    <div className="page page-tight">
      <div className="page-toolbar">
        <div className="tab-bar">
          <button
            className={`tab-btn ${subTab === "docs" ? "active" : ""}`}
            onClick={() => setSubTab("docs")}
          >
            <FileText size={13} />
            指令文档
          </button>
          <button
            className={`tab-btn ${subTab === "snippets" ? "active" : ""}`}
            onClick={() => setSubTab("snippets")}
          >
            <Scissors size={13} />
            共享片段
          </button>
        </div>
        <div className="toolbar-spacer" />
        <span className="toolbar-count">
          {subTab === "docs"
            ? "编辑前自动备份 · 保存即快照"
            : "一份规则，分发到所有 Agent 的受管标记块"}
        </span>
      </div>

      {subTab === "docs" ? <DocsTab /> : <SnippetsTab />}
    </div>
  );
}

function DocsTab() {
  const { agents } = useData();
  const { push } = useToast();
  const [docs, setDocs] = useState<InstructionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DocKey | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [showBackups, setShowBackups] = useState(false);
  const [previewBackup, setPreviewBackup] = useState<{ name: string; content: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<DocKey | null>(null);

  const agentName = useCallback(
    (key: string) => agents.find((a) => a.key === key)?.display_name ?? key,
    [agents]
  );

  const loadDocs = useCallback(async () => {
    try {
      const list = await api.getInstructionDocs();
      setDocs(list);
      return list;
    } catch (e) {
      push(`加载文档清单失败: ${String(e)}`, "error");
      return [];
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // 按 agent 分组
  const grouped = useMemo(() => {
    const map = new Map<string, InstructionDoc[]>();
    for (const d of docs) {
      const arr = map.get(d.agent_key) ?? [];
      arr.push(d);
      map.set(d.agent_key, arr);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
      );
    }
    return [...map.entries()];
  }, [docs]);

  const selectedDoc = useMemo(
    () => docs.find((d) => selected && d.agent_key === selected.agentKey && d.file_name === selected.fileName) ?? null,
    [docs, selected]
  );

  const dirty = content !== original;

  const openDoc = useCallback(
    async (key: DocKey) => {
      setDocLoading(true);
      setShowBackups(false);
      setViewMode("edit");
      try {
        const text = await api.readInstructionDoc(key.agentKey, key.fileName);
        setContent(text);
        setOriginal(text);
        setSelected(key);
        if (isTauri) {
          api.listDocBackups(key.agentKey, key.fileName).then(setBackups).catch(() => setBackups([]));
        }
      } catch (e) {
        setContent("");
        setOriginal("");
        setSelected(key);
        push(`文档不存在或读取失败：${String(e)}`, "info");
      } finally {
        setDocLoading(false);
      }
    },
    [push]
  );

  const requestSelect = (key: DocKey) => {
    if (selected && keyOf(key) === keyOf(selected)) return;
    if (dirty) {
      setPendingSwitch(key);
      return;
    }
    openDoc(key);
  };

  const save = useCallback(async () => {
    if (!selected || !selectedDoc) return;
    if (!selectedDoc.editable) {
      push("该文档由程序自动维护，禁止编辑", "error");
      return;
    }
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await api.writeInstructionDoc(selected.agentKey, selected.fileName, content);
      setOriginal(content);
      push(
        res.backup_name
          ? `已保存（备份 ${res.backup_name}）`
          : "已保存",
        "success"
      );
      await loadDocs();
      if (isTauri) {
        const list = await api.listDocBackups(selected.agentKey, selected.fileName);
        setBackups(list);
      }
    } catch (e) {
      push(`保存失败: ${String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  }, [selected, selectedDoc, dirty, content, push, loadDocs]);

  // Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const doRestore = async () => {
    if (!selected || !restoreTarget) return;
    try {
      await api.restoreDocBackup(selected.agentKey, selected.fileName, restoreTarget);
      push("已恢复备份（恢复前已自动备份当前内容）", "success");
      setRestoreTarget(null);
      setPreviewBackup(null);
      setShowBackups(false);
      await openDoc(selected);
      await loadDocs();
    } catch (e) {
      push(`恢复失败: ${String(e)}`, "error");
    }
  };

  if (loading) {
    return <div className="docs-loading">加载文档清单…</div>;
  }

  if (docs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="未发现任何约束文档"
        description="未在本机找到 CLAUDE.md / AGENTS.md / awareness 文档。安装对应 Agent 后刷新即可。"
      />
    );
  }

  return (
    <div className="docs-layout">
      {/* 左栏：Agent */}
      <div className="docs-col docs-agents">
        {grouped.map(([agentKey, agentDocs]) => (
          <button
            key={agentKey}
            className={`doc-agent-item ${
              selected?.agentKey === agentKey ? "active" : ""
            }`}
            onClick={() => {
              const first = agentDocs.find((d) => d.editable) ?? agentDocs[0];
              requestSelect({ agentKey, fileName: first.file_name });
            }}
          >
            <span className="agent-avatar">{agentName(agentKey).charAt(0).toUpperCase()}</span>
            <div className="doc-agent-info">
              <div className="doc-agent-name">{agentName(agentKey)}</div>
              <div className="doc-agent-sub">
                {agentDocs.filter((d) => d.exists).length}/{agentDocs.length} 个文档
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 中栏：文件列表 */}
      <div className="docs-col docs-files">
        {selected &&
          (docs
            .filter((d) => d.agent_key === selected.agentKey)
            .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
            .map((d) => (
              <button
                key={d.file_name}
                className={`file-item ${
                  selected.fileName === d.file_name ? "active" : ""
                }`}
                onClick={() => requestSelect({ agentKey: d.agent_key, fileName: d.file_name })}
                title={`~/${d.rel_path}`}
              >
                <div className="file-item-head">
                  {d.editable ? <FileText size={13} /> : <Lock size={13} />}
                  <span className="file-name">{d.file_name}</span>
                  <span className={`tag tag-role-${roleClass(d.role)}`}>{d.role}</span>
                </div>
                <div className="file-item-meta">
                  {d.exists ? `${fmtSize(d.size)} · ${fmtRelTime(d.modified)}` : "不存在（保存时创建）"}
                </div>
              </button>
            )))}
        {!selected && <div className="docs-loading">选择左侧 Agent 查看文档</div>}
      </div>

      {/* 右栏：编辑器 */}
      <div className="docs-editor">
        {!selected || !selectedDoc ? (
          <EmptyState
            icon={PenLine}
            title="选择一个文档开始编辑"
            description="保存时自动备份到 ~/.skillman/backups/，可随时恢复。MEMORY.md 等程序自维护文件为只读。"
          />
        ) : (
          <>
            <div className="editor-toolbar">
              <div className="editor-file-title">
                {selectedDoc.file_name}
                {dirty && <span className="dirty-dot" title="有未保存更改" />}
                {!selectedDoc.editable && (
                  <span className="tag tag-neutral">
                    <Lock size={10} />
                    只读
                  </span>
                )}
              </div>
              <div className="toolbar-spacer" />
              <div className="tab-bar tab-bar-sm">
                <button
                  className={`tab-btn ${viewMode === "edit" ? "active" : ""}`}
                  onClick={() => setViewMode("edit")}
                  disabled={!selectedDoc.editable}
                >
                  <PenLine size={12} />
                  编辑
                </button>
                <button
                  className={`tab-btn ${viewMode === "preview" ? "active" : ""}`}
                  onClick={() => setViewMode("preview")}
                >
                  <Eye size={12} />
                  预览
                </button>
              </div>
              {isTauri && (
                <button
                  className={`btn btn-ghost ${showBackups ? "btn-toggled" : ""}`}
                  onClick={() => setShowBackups(!showBackups)}
                  title="备份历史"
                >
                  <History size={14} />
                  备份{backups.length > 0 ? ` ${backups.length}` : ""}
                </button>
              )}
              {isTauri && (
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    api
                      .openDocInEditor(selected.agentKey, selected.fileName)
                      .catch((e) => push(String(e), "error"))
                  }
                  title="用系统默认编辑器打开"
                >
                  <SquareArrowOutUpRight size={14} />
                </button>
              )}
              {isTauri && (
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    api
                      .revealDoc(selected.agentKey, selected.fileName)
                      .catch((e) => push(String(e), "error"))
                  }
                  title="在资源管理器中定位"
                >
                  <FolderSearch size={14} />
                </button>
              )}
              {selectedDoc.editable && (
                <button
                  className="btn btn-primary"
                  onClick={save}
                  disabled={!dirty || saving}
                  title="Ctrl+S"
                >
                  <Save size={14} />
                  {saving ? "保存中…" : "保存"}
                </button>
              )}
            </div>

            <div className="editor-meta">
              ~/{selectedDoc.rel_path} · {agentName(selectedDoc.agent_key)} ·{" "}
              {selectedDoc.exists
                ? `${fmtSize(selectedDoc.size)} · 修改于 ${fmtTime(selectedDoc.modified)}`
                : "文件尚不存在，保存时创建"}
            </div>

            <div className="editor-area">
              {docLoading ? (
                <div className="docs-loading">读取中…</div>
              ) : viewMode === "preview" ? (
                <div className="preview-scroll">
                  <Markdown content={content} />
                </div>
              ) : (
                <CodeMirror
                  value={content}
                  onChange={setContent}
                  readOnly={!selectedDoc.editable}
                  theme={cmTheme}
                  extensions={[markdown()]}
                  basicSetup={{ foldGutter: false, autocompletion: false }}
                />
              )}

              {showBackups && (
                <div className="backup-panel">
                  <div className="backup-panel-head">
                    <span>备份历史（保留最近 20 份）</span>
                    <button className="btn-icon" onClick={() => setShowBackups(false)}>
                      <X size={14} />
                    </button>
                  </div>
                  {backups.length === 0 ? (
                    <div className="backup-empty">还没有备份。首次保存后自动生成。</div>
                  ) : (
                    backups.map((b) => (
                      <div className="backup-item" key={b.name}>
                        <div className="backup-item-info">
                          <div className="backup-name">{b.name.split(".").slice(-1)[0]}</div>
                          <div className="backup-meta">
                            {fmtTime(b.created)} · {fmtSize(b.size)}
                          </div>
                        </div>
                        <button
                          className="btn btn-sm"
                          onClick={async () => {
                            try {
                              const text = await api.readDocBackup(
                                selected.agentKey,
                                selected.fileName,
                                b.name
                              );
                              setPreviewBackup({ name: b.name, content: text });
                            } catch (e) {
                              push(String(e), "error");
                            }
                          }}
                        >
                          查看
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 切换文档时丢弃未保存更改的确认 */}
      <ConfirmDialog
        open={pendingSwitch !== null}
        title="有未保存的更改"
        message="切换文档将丢弃当前未保存的修改，确定继续吗？"
        confirmText="丢弃并切换"
        danger
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          const target = pendingSwitch!;
          setPendingSwitch(null);
          openDoc(target);
        }}
      />

      {/* 备份内容查看 + 恢复 */}
      <div
        className={`preview-modal-overlay ${previewBackup ? "open" : ""}`}
        onMouseDown={() => setPreviewBackup(null)}
      >
        {previewBackup && (
          <div className="preview-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="preview-modal-head">
              <span className="preview-modal-title">备份：{previewBackup.name}</span>
              <button className="btn-icon" onClick={() => setPreviewBackup(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="preview-modal-body">
              <Markdown content={previewBackup.content} />
            </div>
            <div className="preview-modal-actions">
              <button className="btn btn-ghost" onClick={() => setPreviewBackup(null)}>
                关闭
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setRestoreTarget(previewBackup.name)}
              >
                <History size={14} />
                恢复此版本
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        title="恢复备份"
        message={
          <>
            将用备份 <b>{restoreTarget}</b> 覆盖当前文档内容。
            <br />
            覆盖前会先自动备份当前内容，可随时找回。
          </>
        }
        confirmText="恢复"
        onCancel={() => setRestoreTarget(null)}
        onConfirm={doRestore}
      />
    </div>
  );
}

function roleClass(role: string): string {
  switch (role) {
    case "指令":
      return "instructions";
    case "人格":
      return "persona";
    case "用户画像":
      return "user";
    case "记忆":
      return "memory";
    default:
      return "instructions";
  }
}
