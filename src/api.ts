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
} from "./types";
import { isTauri, mock, mockToggleSkill, mockTogglePlugin } from "./mock";

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

// ---- 反向发现 / 体检 / 技能详情 ----

export async function getUnmanaged(): Promise<UnmanagedItem[]> {
  if (!isTauri) return mock.getUnmanaged();
  return invoke<UnmanagedItem[]>("get_unmanaged");
}

export async function getIssues(): Promise<Issue[]> {
  if (!isTauri) return mock.getIssues();
  return invoke<Issue[]>("get_issues");
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
