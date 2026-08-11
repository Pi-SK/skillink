use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::registry::{expand_tilde, AgentDef};
use crate::sync;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    /// skill 来源："独立" 或 plugin 名
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "独立".into()
}

/// 扫描 ~/.agents/skills 下所有含 SKILL.md 的子目录
pub fn scan_source_skills(source_dir: &str) -> Vec<SkillInfo> {
    let dir = expand_tilde(source_dir);
    let mut skills = Vec::new();
    if !dir.exists() || !dir.is_dir() {
        return skills;
    }
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_md = path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }
            let id = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let (name, description) = parse_skill_md(&skill_md, &id);
            skills.push(SkillInfo {
                id,
                name,
                description,
                source: "独立".into(),
            });
        }
    }
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    skills
}

/// 扫描 ~/.agents/plugins/*/skills/ 下的 plugin 内嵌 skill
pub fn scan_plugin_skills(plugins_dir: &str) -> Vec<SkillInfo> {
    let dir = expand_tilde(plugins_dir);
    let mut skills = Vec::new();
    if !dir.exists() || !dir.is_dir() {
        return skills;
    }
    // 遍历每个 plugin 目录
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let plugin_path = entry.path();
            if !plugin_path.is_dir() {
                continue;
            }
            let plugin_name = plugin_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let plugin_skills_dir = plugin_path.join("skills");
            if !plugin_skills_dir.exists() || !plugin_skills_dir.is_dir() {
                continue;
            }
            // 遍历 plugin 内的 skills/
            if let Ok(skill_entries) = std::fs::read_dir(&plugin_skills_dir) {
                for skill_entry in skill_entries.flatten() {
                    let skill_path = skill_entry.path();
                    if !skill_path.is_dir() {
                        continue;
                    }
                    let skill_md = skill_path.join("SKILL.md");
                    if !skill_md.exists() {
                        continue;
                    }
                    let id = skill_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let (name, description) = parse_skill_md(&skill_md, &id);
                    skills.push(SkillInfo {
                        id,
                        name,
                        description,
                        source: plugin_name.clone(),
                    });
                }
            }
        }
    }
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    skills
}

/// 解析 SKILL.md 的 YAML frontmatter（容错）
pub fn parse_skill_md(path: &Path, fallback_id: &str) -> (String, String) {
    let content = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return (fallback_id.to_string(), String::new()),
    };
    let mut name = String::new();
    let mut description = String::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut in_frontmatter = false;

    if lines.first().map(|l| l.trim()) == Some("---") {
        in_frontmatter = true;
    }

    for line in &lines[1..] {
        let trimmed = line.trim();
        if trimmed == "---" && in_frontmatter {
            break;
        }
        if in_frontmatter {
            if let Some(value) = trimmed.strip_prefix("name:") {
                name = value.trim().to_string();
            } else if let Some(value) = trimmed.strip_prefix("description:") {
                description = value.trim().to_string();
            }
        }
    }

    if name.is_empty() {
        name = fallback_id.to_string();
    }
    if description.is_empty() {
        // 取 frontmatter 后第一个非空、非标题的文本行作为简介
        let mut past = false;
        for line in &lines {
            let t = line.trim();
            if t == "---" && !past {
                past = true;
                continue;
            }
            if past && t == "---" {
                // skip second --- after frontmatter (should not normally be there)
                continue;
            }
            if past && !t.is_empty() && !t.starts_with('#') {
                description = t.chars().take(100).collect();
                break;
            }
        }
    }
    (name, description)
}

/// 检查有哪些 Agent 的 skills_dir 内已有指向源目录的 link
#[allow(dead_code)]
pub fn inspect_links(agents: &[AgentDef], source_dir: &str) -> Vec<String> {
    let source = expand_tilde(source_dir);
    let mut linked: Vec<String> = Vec::new();

    for agent in agents {
        let target_dir = expand_tilde(&agent.skills_dir);
        if !target_dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&target_dir) {
            for entry in entries.flatten() {
                let ep = entry.path();
                if ep.is_dir() {
                    if let Ok(resolved) = sync::read_link_target(&ep) {
                        if resolved.starts_with(&source) {
                            linked.push(agent.key.clone());
                            break;
                        }
                    }
                }
            }
        }
    }
    linked
}
