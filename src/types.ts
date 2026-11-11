// 共享类型定义（与 Rust 端 serde 结构一一对应）

export interface AgentStatus {
  key: string;
  display_name: string;
  detected: boolean;
  skills_dir: string;
  plugins_dir: string | null;
  sync_mode: string;
  /** 忽略该平台（不同步，但在技能/插件页折叠） */
  ignored: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  /** "独立" 或 plugin 名 */
  source: string;
  /** SKILL.md frontmatter 版本号，缺省 "—" */
  version: string;
  /** SKILL.md 修改时间 (unix 毫秒) */
  mtime_ms: number;
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
  /** plugin.json 版本号，缺省为空串 */
  version: string;
  /** plugin.json（或插件目录）修改时间 unix 毫秒 */
  mtime_ms: number;
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

/** 未纳管资产（反向发现） */
export interface UnmanagedItem {
  agent_key: string;
  /** "skill" | "plugin" */
  kind: string;
  name: string;
  path: string;
  /** 若是链接但指向 ~/.agents 之外，则为目标路径 */
  link_target: string | null;
  /** skill 的描述；plugin 为 plugin.json 描述 */
  description: string;
  /** skill 行："独立" 或内嵌它的 plugin 名；plugin 行为空串 */
  source: string;
  /** 版本号（skill=SKILL.md frontmatter / plugin=plugin.json），缺省空串 */
  version: string;
  /** 修改时间 unix 毫秒 */
  mtime_ms: number;
}

/** 插件详情（详情抽屉） */
export interface PluginDetail {
  name: string;
  version: string;
  description: string;
  mtime_ms: number;
  skills: PluginSkillBrief[];
}

export interface PluginSkillBrief {
  id: string;
  name: string;
  description: string;
  version: string;
}

/** 删除结果 */
export interface DeleteResult {
  /** 回收区中的位置 */
  trashed_to: string;
  /** 顺带清理掉的 Agent 链接数 */
  removed_links: number;
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
