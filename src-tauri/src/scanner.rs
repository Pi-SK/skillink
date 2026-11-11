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
    /// 版本号，从 SKILL.md frontmatter 读取，缺省为 "—"
    #[serde(default = "default_version")]
    pub version: String,
    /// SKILL.md 最后修改时间 (unix 毫秒)
    #[serde(default)]
    pub mtime_ms: u64,
}

fn default_version() -> String {
    "—".into()
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
            let (name, description, version, mtime_ms) = parse_skill_md(&skill_md, &id);
            skills.push(SkillInfo {
                id,
                name,
                description,
                source: "独立".into(),
                version,
                mtime_ms,
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
                    let (name, description, version, mtime_ms) = parse_skill_md(&skill_md, &id);
                    skills.push(SkillInfo {
                        id,
                        name,
                        description,
                        source: plugin_name.clone(),
                        version,
                        mtime_ms,
                    });
                }
            }
        }
    }
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    skills
}

/// 解析 SKILL.md 的 YAML frontmatter（容错），返回 (name, description, version, mtime_ms)
/// 支持 YAML 块标量：| (literal) 和 > (folded)
pub fn parse_skill_md(path: &Path, fallback_id: &str) -> (String, String, String, u64) {
    let mtime_ms = std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let content = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return (fallback_id.to_string(), String::new(), String::new(), mtime_ms),
    };
    let mut name = String::new();
    let mut description = String::new();
    let mut version = String::new();
    let lines: Vec<&str> = content.lines().collect();

    if lines.first().map(|l| l.trim()) != Some("---") {
        // 无 frontmatter，取文件前几行作为描述
        if name.is_empty() {
            name = fallback_id.to_string();
        }
        for line in &lines {
            let t = line.trim();
            if !t.is_empty() && !t.starts_with('#') {
                description = t.chars().take(100).collect();
                break;
            }
        }
        return (name, description, version, mtime_ms);
    }

    let mut i: usize = 1;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed == "---" {
            break;
        }
        // 跳过空行
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        // 找冒号分割 key: value
        if let Some(colon_pos) = trimmed.find(':') {
            let key = trimmed[..colon_pos].trim();
            let after_colon = trimmed[colon_pos + 1..].trim();

            // 检查是否块标量
            let is_block = matches!(after_colon, "|" | "|-" | "|+" | ">" | ">-" | ">+");
            let block_type = if after_colon.starts_with('|') { '|' } else if after_colon.starts_with('>') { '>' } else { ' ' };

            let value: String;
            if is_block {
                // 读取后续缩进行
                value = collect_block_scalar(&lines, &mut i, block_type);
            } else {
                // 普通 inline 值，去除引号
                let v = after_colon;
                let v = v.strip_prefix('"').unwrap_or(v);
                let v = v.strip_suffix('"').unwrap_or(v);
                let v = v.strip_prefix('\'').unwrap_or(v);
                let v = v.strip_suffix('\'').unwrap_or(v);
                value = v.to_string();
            }

            match key {
                "name" => name = value,
                "description" => description = value,
                "version" => version = value,
                _ => {}
            }
            i += 1;
        } else {
            i += 1;
        }
    }

    if name.is_empty() {
        name = fallback_id.to_string();
    }
    if description.is_empty() {
        // 取 frontmatter 后第一个非空、非标题的文本行作为简介
        let mut past_frontmatter = false;
        for line in &lines {
            let t = line.trim();
            if t == "---" && !past_frontmatter {
                past_frontmatter = true;
                continue;
            }
            if past_frontmatter {
                if t.is_empty() || t.starts_with('#') {
                    continue;
                }
                if t.starts_with("<!--") || t.starts_with("<!") {
                    continue;
                }
                description = t.chars().take(100).collect();
                break;
            }
        }
    }
    (name, description, version, mtime_ms)
}

/// 从 lines[i+1..] 收集 YAML 块标量的缩进行，更新 i 到最后一行
fn collect_block_scalar(lines: &[&str], i: &mut usize, block_type: char) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let mut min_indent = usize::MAX;
    let mut j = *i + 1;

    while j < lines.len() {
        let t = lines[j];
        if t.trim().is_empty() {
            j += 1;
            continue;
        }
        if t.trim() == "---" {
            break;
        }
        let indent = t.chars().take_while(|c| c.is_whitespace()).count();
        // 无缩进的非空行且已有内容 → 块结束
        if indent == 0 && !parts.is_empty() {
            if let Some(cp) = t.find(':') {
                let after = &t[cp + 1..];
                if after.starts_with(' ') || after.is_empty() {
                    break;
                }
            }
        }
        if indent < min_indent {
            min_indent = indent;
        }
        parts.push(t);
        *i = j;
        j += 1;
    }

    let stripped: Vec<String> = parts
        .iter()
        .map(|line| {
            if line.len() > min_indent {
                line[min_indent..].to_string()
            } else {
                String::new()
            }
        })
        .collect();

    match block_type {
        '|' => stripped.join("\n"),
        '>' => stripped.join(" "),
        _ => stripped.join(" "),
    }
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
