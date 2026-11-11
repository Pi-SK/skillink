use crate::instructions;
use crate::registry::{self, expand_tilde, AgentStatus};
use crate::scanner::{self, SkillInfo};
use crate::sync;
use serde::Serialize;

/// 应用主题变化时切换 Windows 窗口材质（Mica 深/浅）。
/// 非 Windows 平台为 no-op；theme 为 "light" 时用 MicaLight，否则 MicaDark。
#[tauri::command]
pub fn set_window_effect(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::Effect;
        let effect = if theme == "light" {
            Effect::MicaLight
        } else {
            Effect::MicaDark
        };
        window
            .set_effects(WindowEffectsConfig {
                effects: vec![effect],
                ..Default::default()
            })
            .map_err(|e| format!("切换窗口材质失败: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, theme);
        Ok(())
    }
}

// ---- 无边框窗口控制（decorations: false 后由前端顶栏提供按钮） ----

/// 从顶栏任意空白处开始拖动窗口（需要前端绑定 mousedown）
#[tauri::command]
pub fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|e| format!("无法开始拖动窗口: {}", e))
}

#[tauri::command]
pub fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .minimize()
        .map_err(|e| format!("无法最小化窗口: {}", e))
}

#[tauri::command]
pub fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window.unmaximize().map_err(|e| format!("无法还原窗口: {}", e))
    } else {
        window.maximize().map_err(|e| format!("无法最大化窗口: {}", e))
    }
}

#[tauri::command]
pub fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .close()
        .map_err(|e| format!("无法关闭窗口: {}", e))
}

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
                ignored: a.ignored,
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

    // plugin 内嵌 skill（目标子目录为 {plugin}__{id} 避免与独立 skill 同名）
    for skill in &plugin_skills {
        for agent in &agents {
            let skill_source = plugins_source
                .join(&skill.source)
                .join("skills")
                .join(&skill.id);
            let target_subdir = format!("{}__{}", skill.source, skill.id);
            let target = expand_tilde(&agent.skills_dir).join(&target_subdir);
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

    if agent.ignored {
        return Err(format!("Agent「{}」已被忽略，无法同步", agent.display_name));
    }

    // 根据 plugin_name 决定源路径和目标子目录名（防止与独立 skill 同名冲突）
    let (source, target_subdir) = if let Some(pn) = &plugin_name {
        (
            expand_tilde("~/.agents/plugins").join(pn).join("skills").join(&skill_id),
            format!("{}__{}", pn, skill_id),
        )
    } else {
        (
            expand_tilde("~/.agents/skills").join(&skill_id),
            skill_id.clone(),
        )
    };

    if !source.exists() {
        return Err(format!("源 skill 不存在: {}", source.display()));
    }

    let target = expand_tilde(&agent.skills_dir).join(&target_subdir);

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

    let (name, description, version, mtime_ms) = scanner::parse_skill_md(&dest.join("SKILL.md"), &id);
    Ok(SkillInfo {
        id,
        name,
        description,
        source: "独立".into(),
        version,
        mtime_ms,
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

/// 修改指定 Agent 的同步方式（"auto"=junction / "copy"=文件复制）
#[tauri::command]
pub fn set_agent_sync_mode(agent_key: String, sync_mode: String) -> Result<String, String> {
    if sync_mode != "auto" && sync_mode != "copy" {
        return Err(format!("无效的同步方式: {}（仅 auto / copy）", sync_mode));
    }
    let user_path = registry::user_agents_path();
    if let Some(parent) = user_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    let mut user_agents: Vec<serde_json::Value> = if user_path.exists() {
        let content = std::fs::read_to_string(&user_path)
            .map_err(|e| format!("无法读取 agents.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    // 查找已有项或追加新项
    if let Some(item) = user_agents.iter_mut().find(|v| v.get("key").and_then(|k| k.as_str()) == Some(&agent_key)) {
        item["sync_mode"] = serde_json::Value::String(sync_mode.clone());
    } else {
        let builtin = registry::builtin_agents()
            .into_iter()
            .find(|a| a.key == agent_key)
            .ok_or_else(|| format!("未知 Agent: {}", agent_key))?;
        let mut item = serde_json::json!({
            "key": builtin.key,
            "display_name": builtin.display_name,
            "skills_dir": builtin.skills_dir,
            "sync_mode": sync_mode,
        });
        if let Some(pd) = builtin.plugins_dir {
            item["plugins_dir"] = serde_json::Value::String(pd);
        }
        item["detect_dir"] = serde_json::Value::String(builtin.detect_dir);
        user_agents.push(item);
    }
    let json = serde_json::to_string_pretty(&user_agents)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&user_path, &json).map_err(|e| format!("写入失败: {}", e))?;
    Ok(sync_mode)
}

/// 忽略/取消忽略某个 Agent（忽略后不同步但可扫描）
#[tauri::command]
pub fn set_agent_ignored(agent_key: String, ignored: bool) -> Result<bool, String> {
    let user_path = registry::user_agents_path();
    if let Some(parent) = user_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    let mut user_agents: Vec<serde_json::Value> = if user_path.exists() {
        let content = std::fs::read_to_string(&user_path)
            .map_err(|e| format!("无法读取 agents.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    if let Some(item) = user_agents.iter_mut().find(|v| v.get("key").and_then(|k| k.as_str()) == Some(&agent_key)) {
        item["ignored"] = serde_json::Value::Bool(ignored);
    } else {
        let builtin = registry::builtin_agents()
            .into_iter()
            .find(|a| a.key == agent_key)
            .ok_or_else(|| format!("未知 Agent: {}", agent_key))?;
        let mut item = serde_json::json!({
            "key": builtin.key,
            "display_name": builtin.display_name,
            "skills_dir": builtin.skills_dir,
            "ignored": ignored,
        });
        if let Some(pd) = builtin.plugins_dir {
            item["plugins_dir"] = serde_json::Value::String(pd);
        }
        item["detect_dir"] = serde_json::Value::String(builtin.detect_dir);
        user_agents.push(item);
    }
    let json = serde_json::to_string_pretty(&user_agents)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&user_path, &json).map_err(|e| format!("写入失败: {}", e))?;
    Ok(ignored)
}

/// 保存/更新自定义 Agent 到 ~/.skillink/agents.json
#[tauri::command]
pub fn save_custom_agent(
    key: String,
    display_name: String,
    skills_dir: String,
    plugins_dir: Option<String>,
    detect_dir: String,
    sync_mode: String,
) -> Result<String, String> {
    if key.is_empty() || key.contains('/') || key.contains('\\') {
        return Err("key 不能为空且不能包含路径分隔符".into());
    }
    if display_name.is_empty() {
        return Err("display_name 不能为空".into());
    }
    if sync_mode != "auto" && sync_mode != "copy" {
        return Err(format!("无效的同步方式: {}（仅 auto / copy）", sync_mode));
    }
    let user_path = registry::user_agents_path();
    if let Some(parent) = user_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    let mut user_agents: Vec<serde_json::Value> = if user_path.exists() {
        let content = std::fs::read_to_string(&user_path)
            .map_err(|e| format!("无法读取 agents.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut item = serde_json::json!({
        "key": key,
        "display_name": display_name,
        "skills_dir": skills_dir,
        "detect_dir": detect_dir,
        "sync_mode": sync_mode,
    });
    if let Some(pd) = &plugins_dir {
        if !pd.is_empty() {
            item["plugins_dir"] = serde_json::Value::String(pd.clone());
        }
    }
    if let Some(existing) = user_agents.iter_mut().find(|v| v.get("key").and_then(|k| k.as_str()) == Some(&key)) {
        *existing = item;
    } else {
        user_agents.push(item);
    }
    let json = serde_json::to_string_pretty(&user_agents)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&user_path, &json).map_err(|e| format!("写入失败: {}", e))?;
    Ok(key)
}

// ---- plugin 命令 ----

#[derive(Debug, Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub has_skills: bool,
    pub skill_count: usize,
    pub description: String,
    /// plugin.json 中的版本号，缺省为空串
    pub version: String,
    /// plugin.json（或插件目录）修改时间 unix 毫秒
    pub mtime_ms: u64,
}

/// 从 plugin.json（.claude-plugin/ 或 .qoder-plugin/）解析 (描述, 版本, manifest 修改时间毫秒)。
/// manifest 不存在时 mtime 回退为插件目录本身的修改时间。
fn parse_plugin_meta(plugin_path: &std::path::Path) -> (String, String, u64) {
    let dir_mtime = std::fs::metadata(plugin_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    for marker in [".claude-plugin", ".qoder-plugin"] {
        let manifest = plugin_path.join(marker).join("plugin.json");
        if !manifest.exists() {
            continue;
        }
        let mtime_ms = std::fs::metadata(&manifest)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(dir_mtime);
        let (mut description, mut version) = (String::new(), String::new());
        if let Ok(content) = std::fs::read_to_string(&manifest) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(desc) = json.get("description").and_then(|d| d.as_str()) {
                    description = desc.to_string();
                }
                if let Some(v) = json.get("version").and_then(|d| d.as_str()) {
                    version = v.to_string();
                }
            }
        }
        return (description, version, mtime_ms);
    }
    (String::new(), String::new(), dir_mtime)
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
            let (description, version, mtime_ms) = parse_plugin_meta(&path);
            plugins.push(PluginInfo {
                name,
                has_skills,
                skill_count,
                description,
                version,
                mtime_ms,
            });
        }
    }
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    plugins
}

/// 插件详情：版本、描述与内嵌技能清单（供详情抽屉展示）
#[derive(Debug, Serialize)]
pub struct PluginDetail {
    pub name: String,
    pub version: String,
    pub description: String,
    pub mtime_ms: u64,
    pub skills: Vec<PluginSkillBrief>,
}

#[derive(Debug, Serialize)]
pub struct PluginSkillBrief {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
}

#[tauri::command]
pub fn get_plugin_detail(plugin_name: String) -> Result<PluginDetail, String> {
    validate_component(&plugin_name)?;
    let path = expand_tilde("~/.agents/plugins").join(&plugin_name);
    if !path.exists() || !path.is_dir() {
        return Err(format!("插件不存在: {}", plugin_name));
    }
    let (description, version, mtime_ms) = parse_plugin_meta(&path);
    let mut skills = Vec::new();
    let skills_dir = path.join("skills");
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let sp = entry.path();
            if !sp.is_dir() {
                continue;
            }
            let md = sp.join("SKILL.md");
            if !md.exists() {
                continue;
            }
            let id = sp.file_name().unwrap_or_default().to_string_lossy().to_string();
            let (name, description, version, _) = scanner::parse_skill_md(&md, &id);
            skills.push(PluginSkillBrief { id, name, description, version });
        }
    }
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(PluginDetail { name: plugin_name, version, description, mtime_ms, skills })
}

#[tauri::command]
pub fn open_plugin_folder(plugin_name: String) -> Result<(), String> {
    validate_component(&plugin_name)?;
    let source = expand_tilde("~/.agents/plugins").join(&plugin_name);
    if !source.exists() {
        return Err(format!("插件目录不存在: {}", source.display()));
    }
    opener::open(&source).map_err(|e| format!("无法打开目录: {}", e))
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

    if agent.ignored {
        return Err(format!("Agent「{}」已被忽略，无法同步", agent.display_name));
    }

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
    pub description: String,
    /// skill 行："独立" 或内嵌它的 plugin 名；plugin 行为空串
    pub source: String,
    /// 版本号（skill 取 SKILL.md frontmatter / plugin 取 plugin.json），缺省空串
    pub version: String,
    /// 修改时间 unix 毫秒
    pub mtime_ms: u64,
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
        // skill 必须含 SKILL.md 才算资产，顺带解析描述/版本/修改时间
        let (description, version, mtime_ms) = if kind == "skill" {
            let md = ep.join("SKILL.md");
            if !md.exists() {
                continue;
            }
            let name0 = ep.file_name().unwrap_or_default().to_string_lossy().to_string();
            let (_, description, version, mtime_ms) = scanner::parse_skill_md(&md, &name0);
            (description, version, mtime_ms)
        } else {
            parse_plugin_meta(&ep)
        };
        let name = ep.file_name().unwrap_or_default().to_string_lossy().to_string();
        let link_target = match sync::read_link_target(&ep) {
            Ok(target) => {
                // 指向 ~/.agents 的链接 = 已纳管，跳过
                if target.starts_with(managed_source) {
                    continue;
                }
                Some(target.to_string_lossy().to_string())
            }
            Err(_) => None,
        };
        if plugin_filter && !looks_like_plugin(&ep) {
            continue;
        }
        out.push(UnmanagedItem {
            agent_key: agent_key.into(),
            kind: kind.into(),
            name,
            path: ep.to_string_lossy().to_string(),
            link_target,
            description,
            source: if kind == "skill" { "独立".into() } else { String::new() },
            version,
            mtime_ms,
        });
    }
}

/// 补扫未纳管 plugin 内嵌的 skill（marketplace 插件里的技能此前完全不可见）
fn collect_unmanaged_plugin_skills(
    plugin_dir: &std::path::Path,
    plugins_source: &std::path::Path,
    skills_source: &std::path::Path,
    agent_key: &str,
    out: &mut Vec<UnmanagedItem>,
) {
    let entries = match std::fs::read_dir(plugin_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let plugin_path = entry.path();
        if !plugin_path.is_dir() || !looks_like_plugin(&plugin_path) {
            continue;
        }
        // 已纳管 plugin（指向 ~/.agents/plugins 的链接）跳过
        if let Ok(t) = sync::read_link_target(&plugin_path) {
            if t.starts_with(plugins_source) {
                continue;
            }
        }
        let plugin_name = plugin_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let skills_sub = plugin_path.join("skills");
        let skill_entries = match std::fs::read_dir(&skills_sub) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for se in skill_entries.flatten() {
            let sp = se.path();
            if !sp.is_dir() || !sp.join("SKILL.md").exists() {
                continue;
            }
            // 内嵌 skill 自身若已链接到纳管源，跳过
            if let Ok(t) = sync::read_link_target(&sp) {
                if t.starts_with(skills_source) || t.starts_with(plugins_source) {
                    continue;
                }
            }
            let name = sp.file_name().unwrap_or_default().to_string_lossy().to_string();
            let (_, description, version, mtime_ms) =
                scanner::parse_skill_md(&sp.join("SKILL.md"), &name);
            out.push(UnmanagedItem {
                agent_key: agent_key.into(),
                kind: "skill".into(),
                name,
                path: sp.to_string_lossy().to_string(),
                link_target: None,
                description,
                source: plugin_name.clone(),
                version,
                mtime_ms,
            });
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
            let mut plugin_dirs = Vec::new();
            if pd_expanded.exists() {
                collect_unmanaged_in(&pd_expanded, &plugins_source, &agent.key, "plugin", true, &mut result);
                plugin_dirs.push(pd_expanded.clone());
            }
            if pd.ends_with("plugins-custom") {
                if let Some(parent) = pd_expanded.parent() {
                    let marketplace = parent.join("plugins");
                    if marketplace.exists() && marketplace != pd_expanded {
                        collect_unmanaged_in(&marketplace, &plugins_source, &agent.key, "plugin", true, &mut result);
                        plugin_dirs.push(marketplace);
                    }
                }
            }
            // 补扫这些目录下未纳管 plugin 内嵌的 skill
            for pdir in plugin_dirs {
                collect_unmanaged_plugin_skills(&pdir, &plugins_source, &skills_source, &agent.key, &mut result);
            }
        }
    }

    result.sort_by(|a, b| {
        (&a.agent_key, &a.kind, &a.name).cmp(&(&b.agent_key, &b.kind, &b.name))
    });
    result
}

// ---- 纳管：把未纳管资产收编进 ~/.agents 源 ----

/// 纳管前置校验；overwrite=true 时跳过 dest 冲突检查，自动备份旧目录
fn adopt_preflight(origin: &std::path::Path, dest: &std::path::Path, overwrite: bool) -> Result<(), String> {
    if !origin.exists() || !origin.is_dir() {
        return Err(format!("目录不存在: {}", origin.display()));
    }
    if let Ok(t) = sync::read_link_target(origin) {
        if t.starts_with(&expand_tilde("~/.agents")) {
            return Err("该资产已纳管，无需重复操作".into());
        }
    }
    if overwrite && dest.exists() {
        let backup_root = expand_tilde("~/.skillink/backups/adopted");
        std::fs::create_dir_all(&backup_root)
            .map_err(|e| format!("无法创建备份目录: {}", e))?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let backup_name = format!(
            "{}-{}",
            dest.file_name().unwrap_or_default().to_string_lossy(),
            ts
        );
        let bp = backup_root.join(&backup_name);
        std::fs::rename(dest, &bp)
            .map_err(|e| format!("备份旧目录失败: {}", e))?;
    } else if dest.exists() {
        return Err(format!(
            "纳管源中已存在同名资产「{}」，请先处理冲突",
            dest.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    Ok(())
}

/// 纳管技能：复制进 ~/.agents/skills；move 模式原位置替换为 junction（原目录先备份）
#[tauri::command]
pub fn adopt_skill(path: String, mode: String, overwrite: bool) -> Result<sync::SyncResult, String> {
    let origin = std::path::PathBuf::from(&path);
    if !origin.join("SKILL.md").exists() {
        return Err("不是有效技能（缺少 SKILL.md）".into());
    }
    let name = origin
        .file_name()
        .ok_or_else(|| "无法解析技能名".to_string())?
        .to_string_lossy()
        .to_string();
    let dest = expand_tilde("~/.agents/skills").join(&name);
    adopt_preflight(&origin, &dest, overwrite)?;
    let backup_root = expand_tilde("~/.skillink/backups/adopted");
    let res = sync::adopt(&origin, &dest, &mode, &backup_root);
    if res.success {
        Ok(res)
    } else {
        Err(res.error.unwrap_or_else(|| "纳管失败".into()))
    }
}

/// 纳管插件：复制进 ~/.agents/plugins；move 模式原位置替换为 junction（原目录先备份）
#[tauri::command]
pub fn adopt_plugin(path: String, mode: String, overwrite: bool) -> Result<sync::SyncResult, String> {
    let origin = std::path::PathBuf::from(&path);
    if !looks_like_plugin(&origin) {
        return Err("该目录不像插件（缺少 plugin.json / commands / skills 等入口）".into());
    }
    let name = origin
        .file_name()
        .ok_or_else(|| "无法解析插件名".to_string())?
        .to_string_lossy()
        .to_string();
    let dest = expand_tilde("~/.agents/plugins").join(&name);
    adopt_preflight(&origin, &dest, overwrite)?;
    let backup_root = expand_tilde("~/.skillink/backups/adopted");
    let res = sync::adopt(&origin, &dest, &mode, &backup_root);
    if res.success {
        Ok(res)
    } else {
        Err(res.error.unwrap_or_else(|| "纳管失败".into()))
    }
}

// ---- 删除：纳管资产移入回收区（可恢复），并清理指向它的链接 ----

/// 路径组件校验（skill id / plugin 名用于 join），防路径穿越
fn validate_component(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(format!("非法名称: {}", name));
    }
    Ok(())
}

/// 比较链接解析目标与源路径是否同一目录（canonicalize 失败时退回直接比较）
fn link_matches(resolved: &std::path::Path, source: &std::path::Path) -> bool {
    match (std::fs::canonicalize(resolved), std::fs::canonicalize(source)) {
        (Ok(a), Ok(b)) => a == b,
        _ => resolved == source,
    }
}

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    /// 回收区中的位置
    pub trashed_to: String,
    /// 顺带清理掉的 Agent 链接数
    pub removed_links: usize,
}

/// 删除纳管技能：先清理各 Agent skills_dir 中指向它的 junction，再移入回收区。
/// copy 模式产生的真实副本不受影响（它们已独立存在）。
#[tauri::command]
pub fn delete_skill(skill_id: String, plugin_name: Option<String>) -> Result<DeleteResult, String> {
    validate_component(&skill_id)?;
    if let Some(pn) = &plugin_name {
        validate_component(pn)?;
    }
    let source = match &plugin_name {
        Some(pn) => expand_tilde("~/.agents/plugins").join(pn).join("skills").join(&skill_id),
        None => expand_tilde("~/.agents/skills").join(&skill_id),
    };
    if !source.exists() {
        return Err("技能不存在或已被删除".into());
    }
    if sync::is_reparse_point(&source).unwrap_or(false) {
        return Err("该技能源目录本身是链接，拒绝删除".into());
    }

    // 根据 plugin_name 决定目标子目录名（与 toggle_skill / get_matrix 一致）
    let target_subdir = match &plugin_name {
        Some(pn) => format!("{}__{}", pn, skill_id),
        None => skill_id.clone(),
    };

    let mut removed_links = 0;
    for agent in registry::load_all_agents() {
        if agent.key == "agents" {
            continue;
        }
        let target = expand_tilde(&agent.skills_dir).join(&target_subdir);
        if let Ok(resolved) = sync::read_link_target(&target) {
            if link_matches(&resolved, &source) && sync::disable_link(&target).success {
                removed_links += 1;
            }
        }
    }

    let trashed = sync::move_to_trash(&source, "skills")
        .map_err(|e| format!("移入回收区失败: {}", e))?;
    Ok(DeleteResult {
        trashed_to: trashed.to_string_lossy().to_string(),
        removed_links,
    })
}

/// 删除纳管插件：先清理各 Agent 的插件本体链接与其内嵌技能链接，再整体移入回收区。
#[tauri::command]
pub fn delete_plugin(plugin_name: String) -> Result<DeleteResult, String> {
    validate_component(&plugin_name)?;
    let source = expand_tilde("~/.agents/plugins").join(&plugin_name);
    if !source.exists() {
        return Err("插件不存在或已被删除".into());
    }
    if sync::is_reparse_point(&source).unwrap_or(false) {
        return Err("该插件源目录本身是链接，拒绝删除".into());
    }

    // 收集内嵌技能源路径，用于清理指向它们的链接
    let mut skill_sources: Vec<(String, std::path::PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(source.join("skills")) {
        for entry in entries.flatten() {
            let sp = entry.path();
            if sp.is_dir() && sp.join("SKILL.md").exists() {
                let id = sp.file_name().unwrap_or_default().to_string_lossy().to_string();
                skill_sources.push((id, sp));
            }
        }
    }

    let mut removed_links = 0;
    for agent in registry::load_all_agents() {
        if agent.key == "agents" {
            continue;
        }
        // 插件本体链接
        if let Some(pd) = &agent.plugins_dir {
            let target = expand_tilde(pd).join(&plugin_name);
            if let Ok(resolved) = sync::read_link_target(&target) {
                if link_matches(&resolved, &source) && sync::disable_link(&target).success {
                    removed_links += 1;
                }
            }
        }
        // 内嵌技能链接（目标子目录为 {plugin}__{id} 避免与独立 skill 同名）
        let skills_dir = expand_tilde(&agent.skills_dir);
        for (id, sp) in &skill_sources {
            let target = skills_dir.join(format!("{}__{}", plugin_name, id));
            if let Ok(resolved) = sync::read_link_target(&target) {
                if link_matches(&resolved, sp) && sync::disable_link(&target).success {
                    removed_links += 1;
                }
            }
        }
    }

    let trashed = sync::move_to_trash(&source, "plugins")
        .map_err(|e| format!("移入回收区失败: {}", e))?;
    Ok(DeleteResult {
        trashed_to: trashed.to_string_lossy().to_string(),
        removed_links,
    })
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

    // 1) 同名提示：同一 skill id 出现在多个来源（插件内嵌用 {plugin}__{id} 目标目录，已自动区分，不会覆盖）
    let mut sources_by_id: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for s in standalone.iter() {
        sources_by_id.entry(s.id.clone()).or_default().push("独立".into());
    }
    for s in plugin_skills.iter() {
        sources_by_id.entry(s.id.clone()).or_default().push(s.source.clone());
    }
    for (id, sources) in &sources_by_id {
        if sources.len() > 1 {
            let plugin_names: Vec<String> = sources.iter().filter(|s| *s != "独立").cloned().collect();
            let target_info: Vec<String> = std::iter::once("独立".to_string())
                .filter(|_| sources.contains(&"独立".to_string()))
                .map(|_| format!("独立→{}", id))
                .chain(plugin_names.iter().map(|pn| format!("{}→{}__{}", pn, pn, id)))
                .collect();
            issues.push(Issue {
                kind: "name_collision".into(),
                message: format!(
                    "技能 id「{}」在 {} 个来源中同名——链接时已自动区分目标目录（{}），不会互相覆盖",
                    id,
                    sources.len(),
                    target_info.join(" / ")
                ),
                agent_key: None,
                skill_id: Some(id.clone()),
            });
        }
    }

    // 2) 漂移与断链：逐 Agent 逐技能检查目标状态
    // 给每个 skill 算好源路径和它在 agent 中的目标子目录名（插件内嵌用 {plugin}__{id}）
    let all_skills_with_target: Vec<(String, std::path::PathBuf, String)> = standalone
        .iter()
        .map(|s| (s.id.clone(), skills_source.join(&s.id), s.id.clone()))
        .chain(plugin_skills.iter().map(|s| {
            (
                s.id.clone(),
                plugins_source.join(&s.source).join("skills").join(&s.id),
                format!("{}__{}", s.source, s.id),
            )
        }))
        .collect();

    for agent in &agents {
        if agent.key == "agents" {
            continue;
        }
        let target_dir = expand_tilde(&agent.skills_dir);
        for (skill_id, src, target_subdir) in &all_skills_with_target {
            let target = target_dir.join(target_subdir);
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
                            skill_id: Some(skill_id.to_string()),
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
                                skill_id: Some(skill_id.to_string()),
                            });
                        }
                    }
                }
            }
        }
    }
    issues
}

/// 修复单个体检问题
#[tauri::command]
pub fn repair_issue(
    kind: String,
    agent_key: Option<String>,
    skill_id: Option<String>,
) -> Result<sync::SyncResult, String> {
    match kind.as_str() {
        "broken_link" | "drift" => {
            let ak = agent_key.ok_or("缺少 agent_key")?;
            let sid = skill_id.ok_or("缺少 skill_id")?;
            // 先断开再重连
            let agents = registry::load_all_agents();
            let agent = agents.iter().find(|a| a.key == ak)
                .ok_or_else(|| format!("未知 Agent: {}", ak))?;
            let target = expand_tilde(&agent.skills_dir).join(&sid);
            // 如果存在就删掉
            if target.exists() {
                if let Ok(true) = sync::is_reparse_point(&target) {
                    let _ = std::fs::remove_dir(&target);
                } else if agent.sync_mode == "copy" {
                    let _ = std::fs::remove_dir_all(&target);
                }
            }
            // 找源路径
            let skills_source = expand_tilde("~/.agents/skills");
            let plugins_source = expand_tilde("~/.agents/plugins");
            let standalone_src = skills_source.join(&sid);
            let source = if standalone_src.exists() {
                standalone_src
            } else {
                // 搜索 plugin 中的技能
                let mut found: Option<std::path::PathBuf> = None;
                if let Ok(entries) = std::fs::read_dir(&plugins_source) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if !p.is_dir() { continue; }
                        let skill_path = p.join("skills").join(&sid);
                        if skill_path.exists() {
                            found = Some(skill_path);
                            break;
                        }
                    }
                }
                found.ok_or_else(|| format!("找不到技能源: {}", sid))?
            };
            if agent.sync_mode == "copy" {
                copy_dir_recursive(&source, &target)
                    .map(|_| sync::SyncResult { success: true, mode_used: "copy".into(), error: None })
                    .map_err(|e| format!("修复失败: {}", e))
            } else {
                Ok(sync::enable_link(&source, &target))
            }
        }
        "conflict" | "name_collision" => Err("同名技能已自动通过不同的目标子目录区分（{plugin}__{id}），无需手动处理。".into()),
        _ => Err(format!("未知问题类型: {}", kind)),
    }
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

/// 读取某个 skill 的元信息（name, version, description），用于合并时版本比对
#[tauri::command]
pub fn get_skill_meta(skill_path: String) -> Result<serde_json::Value, String> {
    let path = expand_tilde(&skill_path);
    let skill_md = path.join("SKILL.md");
    if !skill_md.exists() {
        return Err("该目录不含 SKILL.md".into());
    }
    let (name, description, version, mtime_ms) = scanner::parse_skill_md(&skill_md, &String::new());
    Ok(serde_json::json!({
        "name": name,
        "description": description,
        "version": version,
        "mtime_ms": mtime_ms,
    }))
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
