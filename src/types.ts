// 共享类型定义（与 Rust 端 serde 结构一一对应）

export interface AgentStatus {
  key: string;
  display_name: string;
  detected: boolean;
  skills_dir: string;
  plugins_dir: string | null;
  sync_mode: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  /** "独立" 或 plugin 名 */
  source: string;
}

export interface MatrixCell {
  agent_key: string;
  skill_id: string;
  linked: boolean;
  source: string;
}

export interface PluginInfo {
  name: string;
  has_skills: boolean;
  skill_count: number;
  description: string;
}

export interface PluginCell {
  agent_key: string;
  plugin_name: string;
  linked: boolean;
}

export interface SyncResult {
  success: boolean;
  mode_used: string;
  error: string | null;
}

/** 未纳管资产（反向发现，只读） */
export interface UnmanagedItem {
  agent_key: string;
  /** "skill" | "plugin" */
  kind: string;
  name: string;
  path: string;
  /** 若是链接但指向 ~/.agents 之外，则为目标路径 */
  link_target: string | null;
}

/** 体检问题项 */
export interface Issue {
  /** "conflict" | "drift" | "broken_link" */
  kind: string;
  message: string;
  agent_key: string | null;
  skill_id: string | null;
}

// ---- 指令文档 ----

export interface InstructionDoc {
  agent_key: string;
  file_name: string;
  rel_path: string;
  /** 指令 / 人格 / 用户画像 / 记忆 */
  role: string;
  editable: boolean;
  exists: boolean;
  size: number;
  /** unix 秒 */
  modified: number;
}

export interface BackupInfo {
  name: string;
  size: number;
  created: number;
}

export interface WriteResult {
  backup_name: string | null;
  bytes_written: number;
}

// ---- 共享片段与分发同步 ----

export interface Snippet {
  id: string;
  name: string;
  content: string;
}

export interface SyncTarget {
  agent_key: string;
  file_name: string;
}

export interface SyncPreviewItem {
  agent_key: string;
  file_name: string;
  doc_exists: boolean;
  /** "not_synced" | "synced" | "changed" | "no_doc" */
  state: string;
  next_content: string;
}

export interface ApplyResult {
  agent_key: string;
  file_name: string;
  success: boolean;
  backup_name: string | null;
  error: string | null;
}
