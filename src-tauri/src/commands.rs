use crate::instructions;
use crate::registry::{self, expand_tilde, AgentStatus};
use crate::scanner::{self, SkillInfo};
use crate::sync;
use serde::Serialize;

// ---- 返回类型 ----

#[derive(Debug, Serialize)]
pub struct MatrixCell {
    pub agent_key: String,
    pub skill_id: String,
    pub linked: bool,
    /// skill 来源："独立" 或 plugin 名
    pub source: String,
}

// ---- commands ----

#[tauri::command]
pub fn get_agents() -> Vec<AgentStatus> {
    registry::load_all_agents()
        .into_iter()
        .map(|a| {
            let detect_dir = expand_tilde(&a.detect_dir);
            let detected = detect_dir.exists();
            AgentStatus {
                key: a.key,
                display_name: a.display_name,
                detected,
                skills_dir: a.skills_dir,
                plugins_dir: a.plugins_dir,
                sync_mode: a.sync_mode,
            }
        })
        .collect()
}

#[tauri::command]
pub fn get_skills() -> Vec<SkillInfo> {
    let mut skills = scanner::scan_source_skills("~/.agents/skills");
    let plugin_skills = scanner::scan_plugin_skills("~/.agents/plugins");
    skills.extend(plugin_skills);
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    skills
}

#[tauri::command]
pub fn get_matrix() -> Vec<MatrixCell> {
    let agents = registry::load_all_agents();
    let standalone_skills = scanner::scan_source_skills("~/.agents/skills");
    let plugin_skills = scanner::scan_plugin_skills("~/.agents/plugins");
    let skills_source = expand_tilde("~/.agents/skills");
    let plugins_source = expand_tilde("~/.agents/plugins");
    let mut matrix = Vec::new();

    // 独立 skill
    for skill in &standalone_skills {
        for agent in &agents {
            let target = expand_tilde(&agent.skills_dir).join(&skill.id);
            let linked = if let Ok(resolved) = sync::read_link_target(&target) {
                resolved.starts_with(&skills_source)
            } else {
                false
            };
            matrix.push(MatrixCell {
                agent_key: agent.key.clone(),
                skill_id: skill.id.clone(),
                linked,
                source: "独立".into(),
            });
        }
    }

    // plugin 内嵌 skill
    for skill in &plugin_skills {
        for agent in &agents {
            let skill_source = plugins_source
                .join(&skill.source)
                .join("skills")
                .join(&skill.id);
            let target = expand_tilde(&agent.skills_dir).join(&skill.id);
            let linked = if let Ok(resolved) = sync::read_link_target(&target) {
                resolved == skill_source
            } else {
                false
            };
            matrix.push(MatrixCell {
                agent_key: agent.key.clone(),
                skill_id: skill.id.clone(),
                linked,
                source: skill.source.clone(),
            });
        }
    }
    matrix
}

#[tauri::command]
pub fn toggle_skill(
    agent_key: String,
    skill_id: String,
    enable: bool,
    plugin_name: Option<String>,
) -> Result<sync::SyncResult, String> {
    let agents = registry::load_all_agents();
    let agent = agents
        .iter()
        .find(|a| a.key == agent_key)
        .ok_or_else(|| format!("未知 Agent: {}", agent_key))?;

    // 根据 plugin_name 决定源路径
    let source = if let Some(pn) = &plugin_name {
        expand_tilde("~/.agents/plugins").join(pn).join("skills").join(&skill_id)
    } else {
        expand_tilde("~/.agents/skills").join(&skill_id)
    };

    if !source.exists() {
        return Err(format!("源 skill 不存在: {}", source.display()));
    }

    let target = expand_tilde(&agent.skills_dir).join(&skill_id);

    if agent.sync_mode == "copy" {
        if enable {
            copy_dir_recursive(&source, &target)
                .map(|_| sync::SyncResult {
                    success: true,
                    mode_used: "copy".into(),
                    error: None,
                })
                .map_err(|e| format!("copy 失败: {}", e))
        } else {
            match sync::is_reparse_point(&target) {
                Ok(true) => Ok(sync::disable_link(&target)),
                _ => {
                    if target.exists() {
                        std::fs::remove_dir_all(&target)
                            .map(|_| sync::SyncResult {
                                success: true,
                                mode_used: "copy".into(),
                                error: None,
                            })
                            .map_err(|e| format!("删除失败: {}", e))
                    } else {
                        Ok(sync::SyncResult {
                            success: true,
                            mode_used: "copy".into(),
                            error: None,
                        })
                    }
                }
            }
        }
    } else {
        if enable {
            Ok(sync::enable_link(&source, &target))
        } else {
            Ok(sync::disable_link(&target))
        }
    }
}

#[tauri::command]
pub fn import_skill(source_path: String) -> Result<SkillInfo, String> {
    let src = std::path::PathBuf::from(&source_path);
    if !src.exists() || !src.is_dir() {
        return Err(format!("源目录不存在: {}", source_path));
    }
    let skill_md = src.join("SKILL.md");
    if !skill_md.exists() {
        return Err("源目录不含 SKILL.md 文件".into());
    }

    let id = src
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let dest = expand_tilde("~/.agents/skills").join(&id);

    if dest.exists() {
        return Err(format!("Skill '{}' 已存在于 ~/.agents/skills", id));
    }

    copy_dir_recursive(&src, &dest).map_err(|e| format!("复制失败: {}", e))?;

    let (name, description) = scanner::parse_skill_md(&dest.join("SKILL.md"), &id);
    Ok(SkillInfo {
        id,
        name,
        description,
        source: "独立".into(),
    })
}

#[tauri::command]
pub fn open_agents_json() -> Result<(), String> {
    let path = registry::user_agents_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    if !path.exists() {
        std::fs::write(&path, "[]").map_err(|e| format!("无法写入: {}", e))?;
    }
    opener::open(&path).map_err(|e| format!("无法打开文件: {}", e))
}

// ---- plugin 命令 ----

#[derive(Debug, Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub has_skills: bool,
    pub skill_count: usize,
    pub description: String,
}

/// 从 plugin.json（.claude-plugin/ 或 .qoder-plugin/）解析描述
fn parse_plugin_description(plugin_path: &std::path::Path) -> String {
    for marker in [".claude-plugin", ".qoder-plugin"] {
        let manifest = plugin_path.join(marker).join("plugin.json");
        if let Ok(content) = std::fs::read_to_string(&manifest) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(desc) = json.get("description").and_then(|d| d.as_str()) {
                    return desc.to_string();
                }
            }
        }
    }
    String::new()
}

/// 列出 ~/.agents/plugins 下的所有 plugin
#[tauri::command]
pub fn get_plugins() -> Vec<PluginInfo> {
    let dir = expand_tilde("~/.agents/plugins");
    let mut plugins = Vec::new();
    if !dir.exists() || !dir.is_dir() {
        return plugins;
    }
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let skills_dir = path.join("skills");
            let has_skills = skills_dir.exists() && skills_dir.is_dir();
            let skill_count = if has_skills {
                std::fs::read_dir(&skills_dir)
                    .map(|rd| rd.filter(|e| e.as_ref().map(|x| x.path().is_dir()).unwrap_or(false)).count())
                    .unwrap_or(0)
            } else {
                0
            };
            let description = parse_plugin_description(&path);
            plugins.push(PluginInfo { name, has_skills, skill_count, description });
        }
    }
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    plugins
}

/// 同步整个 plugin 到指定 Agent 的 plugins_dir
#[tauri::command]
pub fn toggle_plugin(
    agent_key: String,
    plugin_name: String,
    enable: bool,
) -> Result<sync::SyncResult, String> {
    let agents = registry::load_all_agents();
    let agent = agents
        .iter()
        .find(|a| a.key == agent_key)
        .ok_or_else(|| format!("未知 Agent: {}", agent_key))?;

    let plugins_dir = agent
        .plugins_dir
        .as_ref()
        .ok_or_else(|| format!("Agent '{}' 不支持 plugin 同步", agent_key))?;

    let source = expand_tilde("~/.agents/plugins").join(&plugin_name);
    if !source.exists() {
        return Err(format!("源 plugin 不存在: {}", source.display()));
    }

    let target = expand_tilde(plugins_dir).join(&plugin_name);

    if enable {
        Ok(sync::enable_link(&source, &target))
    } else {
        Ok(sync::disable_link(&target))
    }
}

/// 查询 plugin 在各 Agent 的同步状态
#[tauri::command]
pub fn get_plugin_matrix() -> Vec<PluginCell> {
    let agents = registry::load_all_agents();
    let plugins_source = expand_tilde("~/.agents/plugins");
    let mut matrix = Vec::new();

    if !plugins_source.exists() {
        return matrix;
    }

    if let Ok(entries) = std::fs::read_dir(&plugins_source) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let plugin_name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            for agent in &agents {
                let agent_plugins_dir = match &agent.plugins_dir {
                    Some(d) => expand_tilde(d),
                    None => continue,
                };
                let target = agent_plugins_dir.join(&plugin_name);
                let linked = if let Ok(resolved) = sync::read_link_target(&target) {
                    resolved == path
                } else {
                    false
                };
                matrix.push(PluginCell {
                    agent_key: agent.key.clone(),
                    plugin_name: plugin_name.clone(),
                    linked,
                });
            }
        }
    }
    matrix
}

#[derive(Debug, Serialize)]
pub struct PluginCell {
    pub agent_key: String,
    pub plugin_name: String,
    pub linked: bool,
}

// ---- helpers ----

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            if src_path
                .file_name()
                .map(|n| n == ".git")
                .unwrap_or(false)
            {
                continue;
            }
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

// ---- 指令文档命令 ----

#[tauri::command]
pub fn get_instruction_docs() -> Vec<instructions::InstructionDoc> {
    instructions::list_docs()
}

#[tauri::command]
pub fn read_instruction_doc(agent_key: String, file_name: String) -> Result<String, String> {
    instructions::read_doc(&agent_key, &file_name)
}

#[tauri::command]
pub fn write_instruction_doc(
    agent_key: String,
    file_name: String,
    content: String,
) -> Result<instructions::WriteResult, String> {
    instructions::write_doc(&agent_key, &file_name, &content)
}

#[tauri::command]
pub fn list_doc_backups(agent_key: String, file_name: String) -> Vec<instructions::BackupInfo> {
    instructions::list_backups(&agent_key, &file_name)
}

#[tauri::command]
pub fn read_doc_backup(
    agent_key: String,
    file_name: String,
    backup_name: String,
) -> Result<String, String> {
    instructions::read_backup(&agent_key, &file_name, &backup_name)
}

#[tauri::command]
pub fn restore_doc_backup(
    agent_key: String,
    file_name: String,
    backup_name: String,
) -> Result<instructions::WriteResult, String> {
    instructions::restore_backup(&agent_key, &file_name, &backup_name)
}

#[tauri::command]
pub fn open_doc_in_editor(agent_key: String, file_name: String) -> Result<(), String> {
    instructions::open_in_editor(&agent_key, &file_name)
}

#[tauri::command]
pub fn reveal_doc(agent_key: String, file_name: String) -> Result<(), String> {
    instructions::reveal_in_folder(&agent_key, &file_name)
}

// ---- 共享片段命令 ----

#[tauri::command]
pub fn get_snippets() -> Vec<instructions::Snippet> {
    instructions::list_snippets()
}

#[tauri::command]
pub fn save_snippet(
    id: String,
    name: String,
    content: String,
) -> Result<instructions::Snippet, String> {
    instructions::save_snippet(&id, &name, &content)
}

#[tauri::command]
pub fn delete_snippet(id: String) -> Result<(), String> {
    instructions::delete_snippet(&id)
}

#[tauri::command]
pub fn preview_snippet_sync(
    snippet_id: String,
    targets: Vec<instructions::SyncTarget>,
    remove: bool,
) -> Result<Vec<instructions::SyncPreviewItem>, String> {
    let snippet = instructions::get_snippet(&snippet_id)?;
    Ok(instructions::preview_sync(&snippet, &targets, remove))
}

#[tauri::command]
pub fn apply_snippet_sync(
    snippet_id: String,
    targets: Vec<instructions::SyncTarget>,
    remove: bool,
) -> Result<Vec<instructions::ApplyResult>, String> {
    let snippet = instructions::get_snippet(&snippet_id)?;
    Ok(instructions::apply_sync(&snippet, &targets, remove))
}

// ---- 反向发现：未纳管资产（只读） ----

#[derive(Debug, Serialize)]
pub struct UnmanagedItem {
    pub agent_key: String,
    /// "skill" | "plugin"
    pub kind: String,
    pub name: String,
    pub path: String,
    /// 若是指向 ~/.agents 之外的链接，为其目标路径
    pub link_target: Option<String>,
}

/// 目录是否"看起来是 plugin"（有标准入口或标准子目录）
fn looks_like_plugin(path: &std::path::Path) -> bool {
    for marker in [".claude-plugin", ".qoder-plugin", "commands", "agents", "skills", "hooks"] {
        if path.join(marker).exists() {
            return true;
        }
    }
    false
}

fn collect_unmanaged_in(
    dir: &std::path::Path,
    managed_source: &std::path::Path,
    agent_key: &str,
    kind: &str,
    plugin_filter: bool,
    out: &mut Vec<UnmanagedItem>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let ep = entry.path();
        if !ep.is_dir() {
            continue;
        }
        let name = ep.file_name().unwrap_or_default().to_string_lossy().to_string();
        match sync::read_link_target(&ep) {
            Ok(target) => {
                // 指向 ~/.agents 的链接 = 已纳管，跳过
                if target.starts_with(managed_source) {
                    continue;
                }
                if plugin_filter && !looks_like_plugin(&ep) {
                    continue;
                }
                out.push(UnmanagedItem {
                    agent_key: agent_key.into(),
                    kind: kind.into(),
                    name,
                    path: ep.to_string_lossy().to_string(),
                    link_target: Some(target.to_string_lossy().to_string()),
                });
            }
            Err(_) => {
                if plugin_filter && !looks_like_plugin(&ep) {
                    continue;
                }
                out.push(UnmanagedItem {
                    agent_key: agent_key.into(),
                    kind: kind.into(),
                    name,
                    path: ep.to_string_lossy().to_string(),
                    link_target: None,
                });
            }
        }
    }
}

#[tauri::command]
pub fn get_unmanaged() -> Vec<UnmanagedItem> {
    let agents = registry::load_all_agents();
    let skills_source = expand_tilde("~/.agents/skills");
    let plugins_source = expand_tilde("~/.agents/plugins");
    let mut result = Vec::new();

    for agent in &agents {
        if agent.key == "agents" {
            continue;
        }
        // 技能目录
        let skills_dir = expand_tilde(&agent.skills_dir);
        if skills_dir.exists() {
            collect_unmanaged_in(&skills_dir, &skills_source, &agent.key, "skill", false, &mut result);
        }
        // 插件目录：注册目录 + marketplace 兄弟目录（plugins-custom 的兄弟 plugins）
        if let Some(pd) = &agent.plugins_dir {
            let pd_expanded = expand_tilde(pd);
            if pd_expanded.exists() {
                collect_unmanaged_in(&pd_expanded, &plugins_source, &agent.key, "plugin", true, &mut result);
            }
            if pd.ends_with("plugins-custom") {
                if let Some(parent) = pd_expanded.parent() {
                    let marketplace = parent.join("plugins");
                    if marketplace.exists() && marketplace != pd_expanded {
                        collect_unmanaged_in(&marketplace, &plugins_source, &agent.key, "plugin", true, &mut result);
                    }
                }
            }
        }
    }

    result.sort_by(|a, b| {
        (&a.agent_key, &a.kind, &a.name).cmp(&(&b.agent_key, &b.kind, &b.name))
    });
    result
}

// ---- 体检：冲突 / 漂移 / 断链 ----

#[derive(Debug, Serialize)]
pub struct Issue {
    /// "conflict" | "drift" | "broken_link"
    pub kind: String,
    pub message: String,
    pub agent_key: Option<String>,
    pub skill_id: Option<String>,
}

fn file_mtime(path: &std::path::Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

#[tauri::command]
pub fn get_issues() -> Vec<Issue> {
    let agents = registry::load_all_agents();
    let standalone = scanner::scan_source_skills("~/.agents/skills");
    let plugin_skills = scanner::scan_plugin_skills("~/.agents/plugins");
    let skills_source = expand_tilde("~/.agents/skills");
    let plugins_source = expand_tilde("~/.agents/plugins");
    let mut issues = Vec::new();

    // 1) 冲突：同一 skill id 出现在多个来源（不同 plugin 或独立+plugin）
    let mut sources_by_id: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for s in standalone.iter() {
        sources_by_id.entry(s.id.clone()).or_default().push("独立".into());
    }
    for s in plugin_skills.iter() {
        sources_by_id.entry(s.id.clone()).or_default().push(s.source.clone());
    }
    for (id, sources) in &sources_by_id {
        if sources.len() > 1 {
            issues.push(Issue {
                kind: "conflict".into(),
                message: format!("技能 id「{}」存在多个来源：{}（链接时互相覆盖）", id, sources.join("、")),
                agent_key: None,
                skill_id: Some(id.clone()),
            });
        }
    }

    // 2) 漂移与断链：逐 Agent 逐技能检查目标状态
    let all_skills: Vec<(String, std::path::PathBuf)> = standalone
        .iter()
        .map(|s| (s.id.clone(), skills_source.join(&s.id)))
        .chain(plugin_skills.iter().map(|s| {
            (
                s.id.clone(),
                plugins_source.join(&s.source).join("skills").join(&s.id),
            )
        }))
        .collect();

    for agent in &agents {
        if agent.key == "agents" {
            continue;
        }
        let target_dir = expand_tilde(&agent.skills_dir);
        for (skill_id, src) in &all_skills {
            let target = target_dir.join(skill_id);
            match sync::read_link_target(&target) {
                Ok(link_target) => {
                    if !link_target.exists() {
                        issues.push(Issue {
                            kind: "broken_link".into(),
                            message: format!(
                                "{} 中的 {} 是断链（指向不存在的 {}）",
                                agent.display_name,
                                skill_id,
                                link_target.display()
                            ),
                            agent_key: Some(agent.key.clone()),
                            skill_id: Some(skill_id.clone()),
                        });
                    }
                }
                Err(_) => {
                    if !target.exists() {
                        continue;
                    }
                    // 真实目录 = copy 模式副本，比较 SKILL.md 修改时间判断漂移
                    let src_md = src.join("SKILL.md");
                    let tgt_md = target.join("SKILL.md");
                    if let (Some(sm), Some(tm)) = (file_mtime(&src_md), file_mtime(&tgt_md)) {
                        if sm > tm {
                            issues.push(Issue {
                                kind: "drift".into(),
                                message: format!(
                                    "{} 中的 {} 是 copy 副本且源已更新（副本落后）",
                                    agent.display_name, skill_id
                                ),
                                agent_key: Some(agent.key.clone()),
                                skill_id: Some(skill_id.clone()),
                            });
                        }
                    }
                }
            }
        }
    }
    issues
}

// ---- 技能详情 ----

#[tauri::command]
pub fn read_skill_md(skill_id: String, plugin_name: Option<String>) -> Result<String, String> {
    let source = match plugin_name {
        Some(pn) => expand_tilde("~/.agents/plugins").join(pn).join("skills").join(&skill_id),
        None => expand_tilde("~/.agents/skills").join(&skill_id),
    };
    let md = source.join("SKILL.md");
    std::fs::read_to_string(&md).map_err(|_| format!("SKILL.md 不存在: {}", md.display()))
}

#[tauri::command]
pub fn open_skill_folder(skill_id: String, plugin_name: Option<String>) -> Result<(), String> {
    let source = match plugin_name {
        Some(pn) => expand_tilde("~/.agents/plugins").join(pn).join("skills").join(&skill_id),
        None => expand_tilde("~/.agents/skills").join(&skill_id),
    };
    if !source.exists() {
        return Err(format!("源目录不存在: {}", source.display()));
    }
    opener::open(&source).map_err(|e| format!("无法打开目录: {}", e))
}

#[tauri::command]
pub fn open_managed_dir() -> Result<(), String> {
    let dir = expand_tilde("~/.agents");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    opener::open(&dir).map_err(|e| format!("无法打开目录: {}", e))
}
