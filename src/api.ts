import { invoke } from "@tauri-apps/api/core";

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

export async function getAgents(): Promise<AgentStatus[]> {
  return invoke<AgentStatus[]>("get_agents");
}

export async function getSkills(): Promise<SkillInfo[]> {
  return invoke<SkillInfo[]>("get_skills");
}

export async function getMatrix(): Promise<MatrixCell[]> {
  return invoke<MatrixCell[]>("get_matrix");
}

export async function toggleSkill(
  agentKey: string,
  skillId: string,
  enable: boolean,
  pluginName?: string
): Promise<SyncResult> {
  return invoke<SyncResult>("toggle_skill", {
    agentKey,
    skillId,
    enable,
    pluginName: pluginName || null,
  });
}

export async function getPlugins(): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("get_plugins");
}

export async function togglePlugin(
  agentKey: string,
  pluginName: string,
  enable: boolean
): Promise<SyncResult> {
  return invoke<SyncResult>("toggle_plugin", {
    agentKey,
    pluginName,
    enable,
  });
}

export async function getPluginMatrix(): Promise<PluginCell[]> {
  return invoke<PluginCell[]>("get_plugin_matrix");
}

export async function importSkill(sourcePath: string): Promise<SkillInfo> {
  return invoke<SkillInfo>("import_skill", { sourcePath });
}

export async function openAgentsJson(): Promise<void> {
  return invoke<void>("open_agents_json");
}
