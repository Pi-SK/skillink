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
            plugins.push(PluginInfo { name, has_skills, skill_count });
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
