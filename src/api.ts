// Tauri invoke 封装。非 Tauri 环境（浏览器预览）自动降级为 mock 数据。
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentStatus,
  SkillInfo,
  MatrixCell,
  PluginInfo,
  PluginCell,
  SyncResult,
  InstructionDoc,
  BackupInfo,
  WriteResult,
  Snippet,
  SyncTarget,
  SyncPreviewItem,
  ApplyResult,
  UnmanagedItem,
  Issue,
  PluginDetail,
  DeleteResult,
} from "./types";
import { isTauri, mock, mockToggleSkill, mockTogglePlugin, mockAdopt, mockDeleteSkill, mockDeletePlugin } from "./mock";

export async function getAgents(): Promise<AgentStatus[]> {
  if (!isTauri) return mock.getAgents();
  return invoke<AgentStatus[]>("get_agents");
}

export async function getSkills(): Promise<SkillInfo[]> {
  if (!isTauri) return mock.getSkills();
  return invoke<SkillInfo[]>("get_skills");
}

export async function getMatrix(): Promise<MatrixCell[]> {
  if (!isTauri) return mock.getMatrix();
  return invoke<MatrixCell[]>("get_matrix");
}

export async function toggleSkill(
  agentKey: string,
  skillId: string,
  enable: boolean,
  pluginName?: string
): Promise<SyncResult> {
  if (!isTauri) {
    mockToggleSkill(agentKey, skillId, pluginName ?? "独立", enable);
    return { success: true, mode_used: "junction", error: null };
  }
  return invoke<SyncResult>("toggle_skill", {
    agentKey,
    skillId,
    enable,
    pluginName: pluginName || null,
  });
}

export async function getPlugins(): Promise<PluginInfo[]> {
  if (!isTauri) return mock.getPlugins();
  return invoke<PluginInfo[]>("get_plugins");
}

export async function togglePlugin(
  agentKey: string,
  pluginName: string,
  enable: boolean
): Promise<SyncResult> {
  if (!isTauri) {
    mockTogglePlugin(pluginName, agentKey, enable);
    return { success: true, mode_used: "junction", error: null };
  }
  return invoke<SyncResult>("toggle_plugin", {
    agentKey,
    pluginName,
    enable,
  });
}

export async function getPluginMatrix(): Promise<PluginCell[]> {
  if (!isTauri) return mock.getPluginMatrix();
  return invoke<PluginCell[]>("get_plugin_matrix");
}

export async function importSkill(sourcePath: string): Promise<SkillInfo> {
  return invoke<SkillInfo>("import_skill", { sourcePath });
}

export async function openAgentsJson(): Promise<void> {
  return invoke<void>("open_agents_json");
}

/** 应用主题变化时切换 Windows 窗口材质（Mica 深/浅）。非 Windows 为 no-op */
export async function setWindowEffect(theme: "dark" | "light"): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke<void>("set_window_effect", { theme });
  } catch {
    // 材质切换失败不影响功能，静默忽略
  }
}

// ---- 无边框窗口控制（decorations: false，由前端顶栏按钮接管） ----

export async function startWindowDrag(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke<void>("start_window_drag");
  } catch {
    // 拖拽失败不影响功能
  }
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke<void>("minimize_window");
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke<void>("toggle_maximize_window");
}

export async function closeWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke<void>("close_window");
}

/** 修改 Agent 同步方式："auto"（junction） 或 "copy"（文件复制） */
export async function setAgentSyncMode(agentKey: string, syncMode: string): Promise<string> {
  return invoke<string>("set_agent_sync_mode", { agentKey, syncMode });
}

/** 忽略/取消忽略某个 Agent（忽略后不同步但可扫描） */
export async function setAgentIgnored(agentKey: string, ignored: boolean): Promise<boolean> {
  return invoke<boolean>("set_agent_ignored", { agentKey, ignored });
}

/** 保存/更新自定义 Agent */
export async function saveCustomAgent(agent: {
  key: string;
  display_name: string;
  skills_dir: string;
  plugins_dir?: string;
  detect_dir: string;
  sync_mode: string;
}): Promise<string> {
  return invoke<string>("save_custom_agent", {
    key: agent.key,
    displayName: agent.display_name,
    skillsDir: agent.skills_dir,
    pluginsDir: agent.plugins_dir || null,
    detectDir: agent.detect_dir,
    syncMode: agent.sync_mode,
  });
}

/** 读取技能元信息，用于合并时版本比对 */
export async function getSkillMeta(skillPath: string): Promise<{ name: string; description: string; version: string; mtime_ms: number }> {
  return invoke<{ name: string; description: string; version: string; mtime_ms: number }>("get_skill_meta", { skillPath });
}

// ---- 指令文档 ----

export async function getInstructionDocs(): Promise<InstructionDoc[]> {
  if (!isTauri) return mock.getInstructionDocs();
  return invoke<InstructionDoc[]>("get_instruction_docs");
}

export async function readInstructionDoc(agentKey: string, fileName: string): Promise<string> {
  if (!isTauri) return mock.readInstructionDoc(agentKey, fileName);
  return invoke<string>("read_instruction_doc", { agentKey, fileName });
}

export async function writeInstructionDoc(
  agentKey: string,
  fileName: string,
  content: string
): Promise<WriteResult> {
  if (!isTauri) return mock.writeInstructionDoc(agentKey, fileName, content);
  return invoke<WriteResult>("write_instruction_doc", { agentKey, fileName, content });
}

export async function listDocBackups(agentKey: string, fileName: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_doc_backups", { agentKey, fileName });
}

export async function readDocBackup(
  agentKey: string,
  fileName: string,
  backupName: string
): Promise<string> {
  return invoke<string>("read_doc_backup", { agentKey, fileName, backupName });
}

export async function restoreDocBackup(
  agentKey: string,
  fileName: string,
  backupName: string
): Promise<WriteResult> {
  return invoke<WriteResult>("restore_doc_backup", { agentKey, fileName, backupName });
}

export async function openDocInEditor(agentKey: string, fileName: string): Promise<void> {
  return invoke<void>("open_doc_in_editor", { agentKey, fileName });
}

export async function revealDoc(agentKey: string, fileName: string): Promise<void> {
  return invoke<void>("reveal_doc", { agentKey, fileName });
}

// ---- 共享片段与分发同步 ----

export async function getSnippets(): Promise<Snippet[]> {
  if (!isTauri) return mock.getSnippets();
  return invoke<Snippet[]>("get_snippets");
}

export async function saveSnippet(id: string, name: string, content: string): Promise<Snippet> {
  return invoke<Snippet>("save_snippet", { id, name, content });
}

export async function deleteSnippet(id: string): Promise<void> {
  return invoke<void>("delete_snippet", { id });
}

export async function previewSnippetSync(
  snippetId: string,
  targets: SyncTarget[],
  remove: boolean
): Promise<SyncPreviewItem[]> {
  return invoke<SyncPreviewItem[]>("preview_snippet_sync", { snippetId, targets, remove });
}

export async function applySnippetSync(
  snippetId: string,
  targets: SyncTarget[],
  remove: boolean
): Promise<ApplyResult[]> {
  return invoke<ApplyResult[]>("apply_snippet_sync", { snippetId, targets, remove });
}

// ---- 反向发现 / 纳管 / 体检 / 技能详情 ----

export async function getUnmanaged(): Promise<UnmanagedItem[]> {
  if (!isTauri) return mock.getUnmanaged();
  return invoke<UnmanagedItem[]>("get_unmanaged");
}

/** 纳管技能：mode "copy"=仅复制，"move"=复制后原位置换为 junction；overwrite 跳过冲突 */
export async function adoptSkill(path: string, mode: string, overwrite?: boolean): Promise<SyncResult> {
  if (!isTauri) {
    mockAdopt(path);
    return { success: true, mode_used: mode, error: null };
  }
  return invoke<SyncResult>("adopt_skill", { path, mode, overwrite: overwrite ?? false });
}

export async function adoptPlugin(path: string, mode: string, overwrite?: boolean): Promise<SyncResult> {
  if (!isTauri) {
    mockAdopt(path);
    return { success: true, mode_used: mode, error: null };
  }
  return invoke<SyncResult>("adopt_plugin", { path, mode, overwrite: overwrite ?? false });
}

/** 删除纳管技能（移入回收区，可恢复）。pluginName 为内嵌技能所属插件名 */
export async function deleteSkill(skillId: string, pluginName?: string): Promise<DeleteResult> {
  if (!isTauri) {
    mockDeleteSkill(skillId, pluginName ?? "独立");
    return { trashed_to: `~/.skillink/.trash/skills/${skillId}`, removed_links: 0 };
  }
  return invoke<DeleteResult>("delete_skill", {
    skillId,
    pluginName: pluginName || null,
  });
}

/** 删除纳管插件（移入回收区，可恢复），并清理其内嵌技能链接 */
export async function deletePlugin(pluginName: string): Promise<DeleteResult> {
  if (!isTauri) {
    mockDeletePlugin(pluginName);
    return { trashed_to: `~/.skillink/.trash/plugins/${pluginName}`, removed_links: 0 };
  }
  return invoke<DeleteResult>("delete_plugin", { pluginName });
}

/** 读取插件详情（版本 / 描述 / 内嵌技能清单） */
export async function getPluginDetail(pluginName: string): Promise<PluginDetail> {
  if (!isTauri) return mock.getPluginDetail(pluginName);
  return invoke<PluginDetail>("get_plugin_detail", { pluginName });
}

export async function openPluginFolder(pluginName: string): Promise<void> {
  return invoke<void>("open_plugin_folder", { pluginName });
}

export async function getIssues(): Promise<Issue[]> {
  if (!isTauri) return mock.getIssues();
  return invoke<Issue[]>("get_issues");
}

/** 修复单个体检问题 */
export async function repairIssue(issue: Issue): Promise<SyncResult> {
  return invoke<SyncResult>("repair_issue", {
    kind: issue.kind,
    agentKey: issue.agent_key,
    skillId: issue.skill_id,
  });
}

export async function readSkillMd(skillId: string, pluginName?: string): Promise<string> {
  return invoke<string>("read_skill_md", {
    skillId,
    pluginName: pluginName || null,
  });
}

export async function openSkillFolder(skillId: string, pluginName?: string): Promise<void> {
  return invoke<void>("open_skill_folder", {
    skillId,
    pluginName: pluginName || null,
  });
}

export async function openManagedDir(): Promise<void> {
  return invoke<void>("open_managed_dir");
}
