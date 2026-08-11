//! 指令文档管理：各 Agent 全局约束文档（CLAUDE.md / AGENTS.md / awareness 系列）
//! 的清单、读写、备份恢复，以及共享片段的分发同步（受管标记块）。
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::registry::{expand_tilde, home_dir};

// ---- 文档注册表 ----

pub struct DocSpec {
    pub agent_key: &'static str,
    pub file_name: &'static str,
    /// 相对 home 的路径
    pub rel_path: &'static str,
    /// 角色：指令 / 人格 / 用户画像 / 记忆
    pub role: &'static str,
    pub editable: bool,
}

/// 各 Agent 的约束文档布局（依据本机实测结构）
pub fn doc_specs() -> Vec<DocSpec> {
    vec![
        DocSpec { agent_key: "claude", file_name: "CLAUDE.md", rel_path: ".claude/CLAUDE.md", role: "指令", editable: true },
        DocSpec { agent_key: "codex", file_name: "AGENTS.md", rel_path: ".codex/AGENTS.md", role: "指令", editable: true },
        DocSpec { agent_key: "qwenworkcn", file_name: "AGENTS.md", rel_path: ".qwenworkcn/awareness/main/AGENTS.md", role: "指令", editable: true },
        DocSpec { agent_key: "qwenworkcn", file_name: "SOUL.md", rel_path: ".qwenworkcn/awareness/main/SOUL.md", role: "人格", editable: true },
        DocSpec { agent_key: "qwenworkcn", file_name: "USER.md", rel_path: ".qwenworkcn/awareness/main/USER.md", role: "用户画像", editable: true },
        // MEMORY.md 由程序自动维护，禁止手工编辑
        DocSpec { agent_key: "qwenworkcn", file_name: "MEMORY.md", rel_path: ".qwenworkcn/awareness/main/MEMORY.md", role: "记忆", editable: false },
        DocSpec { agent_key: "qoderworkcn", file_name: "AGENTS.md", rel_path: ".qoderworkcn/awareness/main/AGENTS.md", role: "指令", editable: true },
        DocSpec { agent_key: "qoderworkcn", file_name: "SOUL.md", rel_path: ".qoderworkcn/awareness/main/SOUL.md", role: "人格", editable: true },
        DocSpec { agent_key: "qoderworkcn", file_name: "USER.md", rel_path: ".qoderworkcn/awareness/main/USER.md", role: "用户画像", editable: true },
        DocSpec { agent_key: "qoderworkcn", file_name: "MEMORY.md", rel_path: ".qoderworkcn/awareness/main/MEMORY.md", role: "记忆", editable: false },
    ]
}

// ---- 清单 ----

#[derive(Debug, Serialize)]
pub struct InstructionDoc {
    pub agent_key: String,
    pub file_name: String,
    pub rel_path: String,
    pub role: String,
    pub editable: bool,
    pub exists: bool,
    pub size: u64,
    /// unix 秒
    pub modified: i64,
}

pub fn list_docs() -> Vec<InstructionDoc> {
    doc_specs()
        .into_iter()
        .map(|spec| {
            let path = expand_tilde(&format!("~/{}", spec.rel_path));
            let (exists, size, modified) = match std::fs::metadata(&path) {
                Ok(meta) => {
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    (true, meta.len(), mtime)
                }
                Err(_) => (false, 0, 0),
            };
            InstructionDoc {
                agent_key: spec.agent_key.into(),
                file_name: spec.file_name.into(),
                rel_path: spec.rel_path.into(),
                role: spec.role.into(),
                editable: spec.editable,
                exists,
                size,
                modified,
            }
        })
        .collect()
}

fn resolve_path(agent_key: &str, file_name: &str) -> Result<PathBuf, String> {
    let spec = doc_specs()
        .into_iter()
        .find(|s| s.agent_key == agent_key && s.file_name == file_name)
        .ok_or_else(|| format!("未注册的文档: {}/{}", agent_key, file_name))?;
    Ok(expand_tilde(&format!("~/{}", spec.rel_path)))
}

fn resolve_spec(agent_key: &str, file_name: &str) -> Result<DocSpec, String> {
    doc_specs()
        .into_iter()
        .find(|s| s.agent_key == agent_key && s.file_name == file_name)
        .ok_or_else(|| format!("未注册的文档: {}/{}", agent_key, file_name))
}

// ---- 读写 ----

pub fn read_doc(agent_key: &str, file_name: &str) -> Result<String, String> {
    let path = resolve_path(agent_key, file_name)?;
    std::fs::read_to_string(&path)
        .map_err(|e| format!("读取失败 {}: {}", path.display(), e))
}

#[derive(Debug, Serialize)]
pub struct WriteResult {
    pub backup_name: Option<String>,
    pub bytes_written: usize,
}

/// 写盘前自动备份原文件到 ~/.skillman/backups/<agent>/<file>.<时间戳>
fn backup_before_write(agent_key: &str, file_name: &str, path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let dir = backups_dir(agent_key);
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    let ts = timestamp();
    let backup_name = format!("{}.{}", file_name, ts);
    let dest = dir.join(&backup_name);
    match std::fs::copy(path, &dest) {
        Ok(_) => {
            prune_backups(agent_key, file_name, 20);
            Some(backup_name)
        }
        Err(_) => None,
    }
}

pub fn write_doc(agent_key: &str, file_name: &str, content: &str) -> Result<WriteResult, String> {
    let spec = resolve_spec(agent_key, file_name)?;
    if !spec.editable {
        return Err(format!("{} 由程序自动维护，禁止写入", file_name));
    }
    let path = resolve_path(agent_key, file_name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建目录 {}: {}", parent.display(), e))?;
    }
    let backup_name = backup_before_write(agent_key, file_name, &path);
    std::fs::write(&path, content)
        .map_err(|e| format!("写入失败 {}: {}", path.display(), e))?;
    Ok(WriteResult {
        backup_name,
        bytes_written: content.len(),
    })
}

// ---- 备份管理 ----

fn backups_dir(agent_key: &str) -> PathBuf {
    home_dir().join(".skillman").join("backups").join(agent_key)
}

fn timestamp() -> String {
    // 本地时间戳命名（UTC 亦可，仅用于排序与展示）
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_backup_ts(secs)
}

/// 将 unix 秒格式化为 YYYYmmdd-HHMMSS（UTC，保证字典序=时间序）
fn format_backup_ts(secs: u64) -> String {
    let days = secs / 86400;
    let time = secs % 86400;
    let (h, m, s) = (time / 3600, (time % 3600) / 60, time % 60);
    //  Zivilbehuber 日期算法（公历）
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mo <= 2 { y + 1 } else { y };
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        year, mo, d, h, m, s
    )
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created: i64,
}

pub fn list_backups(agent_key: &str, file_name: &str) -> Vec<BackupInfo> {
    let dir = backups_dir(agent_key);
    let prefix = format!("{}.", file_name);
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(&prefix) || !is_valid_backup_name(file_name, &name) {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let created = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            result.push(BackupInfo {
                name,
                size: meta.len(),
                created,
            });
        }
    }
    // 时间戳命名保证字典序 = 时间序，倒序即最新在前
    result.sort_by(|a, b| b.name.cmp(&a.name));
    result
}

/// 备份名必须严格为 "<file_name>.<8位日期>-<6位时间>"，防止路径注入
fn is_valid_backup_name(file_name: &str, name: &str) -> bool {
    let suffix = match name.strip_prefix(file_name) {
        Some(s) => s,
        None => return false,
    };
    let ts = match suffix.strip_prefix('.') {
        Some(s) => s,
        None => return false,
    };
    if ts.len() != 15 {
        return false;
    }
    let (date, time) = (&ts[..8], &ts[9..]);
    ts.as_bytes()[8] == b'-'
        && date.bytes().all(|b| b.is_ascii_digit())
        && time.bytes().all(|b| b.is_ascii_digit())
}

/// 只保留最近 keep 份备份（应用自身生成的中间副本）
fn prune_backups(agent_key: &str, file_name: &str, keep: usize) {
    let backups = list_backups(agent_key, file_name);
    if backups.len() <= keep {
        return;
    }
    let dir = backups_dir(agent_key);
    for old in &backups[keep..] {
        let _ = std::fs::remove_file(dir.join(&old.name));
    }
}

pub fn read_backup(agent_key: &str, file_name: &str, backup_name: &str) -> Result<String, String> {
    if !is_valid_backup_name(file_name, backup_name) {
        return Err("非法的备份名".into());
    }
    let path = backups_dir(agent_key).join(backup_name);
    std::fs::read_to_string(&path).map_err(|e| format!("读取备份失败: {}", e))
}

/// 恢复备份：先备份当前内容，再用备份覆盖
pub fn restore_backup(
    agent_key: &str,
    file_name: &str,
    backup_name: &str,
) -> Result<WriteResult, String> {
    let content = read_backup(agent_key, file_name, backup_name)?;
    write_doc(agent_key, file_name, &content)
}

// ---- 共享片段（Snippets） ----

#[derive(Debug, Clone, Serialize)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub content: String,
}

fn snippets_dir() -> PathBuf {
    home_dir().join(".skillman").join("snippets")
}

fn snippet_path(id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err("片段 id 只能包含小写字母、数字、- 和 _".into());
    }
    Ok(snippets_dir().join(format!("{}.md", id)))
}

pub fn list_snippets() -> Vec<Snippet> {
    let dir = snippets_dir();
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let id = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let (name, body) = parse_snippet_frontmatter(&content, &id);
                    result.push(Snippet { id, name, content: body });
                }
            }
        }
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    result
}

pub fn get_snippet(id: &str) -> Result<Snippet, String> {
    let path = snippet_path(id)?;
    let content = std::fs::read_to_string(&path).map_err(|_| format!("片段不存在: {}", id))?;
    let (name, body) = parse_snippet_frontmatter(&content, id);
    Ok(Snippet {
        id: id.into(),
        name,
        content: body,
    })
}

pub fn save_snippet(id: &str, name: &str, content: &str) -> Result<Snippet, String> {
    let path = snippet_path(id)?;
    std::fs::create_dir_all(snippets_dir())
        .map_err(|e| format!("无法创建片段目录: {}", e))?;
    let name = if name.trim().is_empty() { id } else { name.trim() };
    let file_content = format!("---\nname: {}\n---\n{}\n", name, content.trim_end());
    std::fs::write(&path, file_content).map_err(|e| format!("保存片段失败: {}", e))?;
    Ok(Snippet {
        id: id.into(),
        name: name.into(),
        content: content.into(),
    })
}

/// 删除片段：移入 ~/.skillman/.trash/ 而非永久删除
pub fn delete_snippet(id: &str) -> Result<(), String> {
    let path = snippet_path(id)?;
    if !path.exists() {
        return Ok(());
    }
    let trash = home_dir().join(".skillman").join(".trash");
    std::fs::create_dir_all(&trash).map_err(|e| format!("无法创建回收目录: {}", e))?;
    let ts = timestamp();
    let dest = trash.join(format!("snippet-{}-{}.md", id, ts));
    std::fs::rename(&path, &dest).map_err(|e| format!("删除片段失败: {}", e))
}

fn parse_snippet_frontmatter(content: &str, fallback_name: &str) -> (String, String) {
    let mut lines = content.lines();
    if lines.next().map(|l| l.trim()) != Some("---") {
        return (fallback_name.into(), content.into());
    }
    let mut name = String::new();
    let mut body_start = None;
    for (i, line) in content.lines().enumerate().skip(1) {
        if line.trim() == "---" {
            body_start = Some(i + 1);
            break;
        }
        if let Some(v) = line.trim().strip_prefix("name:") {
            name = v.trim().to_string();
        }
    }
    let body = match body_start {
        Some(idx) => content
            .lines()
            .skip(idx)
            .collect::<Vec<_>>()
            .join("\n")
            .trim_start()
            .to_string(),
        None => content.into(),
    };
    if name.is_empty() {
        name = fallback_name.into();
    }
    (name, body)
}

// ---- 分发同步引擎（受管标记块） ----

fn begin_marker(id: &str) -> String {
    format!("<!-- SKILLMAN:SYNC {} -->", id)
}
const END_MARKER: &str = "<!-- SKILLMAN:END -->";

#[derive(Debug, Serialize, serde::Deserialize)]
pub struct SyncTarget {
    pub agent_key: String,
    pub file_name: String,
}

#[derive(Debug, Serialize)]
pub struct SyncPreviewItem {
    pub agent_key: String,
    pub file_name: String,
    pub doc_exists: bool,
    /// "not_synced" | "synced" | "changed" | "no_doc"
    pub state: String,
    /// 应用后的完整文档内容（供 dry-run 预览）
    pub next_content: String,
}

/// dry-run：不落盘，返回每个目标文档应用后的状态与完整内容
pub fn preview_sync(
    snippet: &Snippet,
    targets: &[SyncTarget],
    remove: bool,
) -> Vec<SyncPreviewItem> {
    let mut result = Vec::new();
    for t in targets {
        let path = match resolve_path(&t.agent_key, &t.file_name) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let doc_exists = path.exists();
        let existing_block = extract_block(&content, &snippet.id);

        let state = if remove {
            if existing_block.is_some() {
                "synced"
            } else {
                "not_synced"
            }
        } else if !doc_exists && content.is_empty() {
            "no_doc"
        } else {
            match existing_block {
                None => "not_synced",
                Some(b) if b.trim() == snippet.content.trim() => "synced",
                Some(_) => "changed",
            }
        };

        let next_content = if remove {
            remove_block(&content, &snippet.id)
        } else {
            upsert_block(&content, &snippet.id, &snippet.content)
        };

        result.push(SyncPreviewItem {
            agent_key: t.agent_key.clone(),
            file_name: t.file_name.clone(),
            doc_exists,
            state: state.into(),
            next_content,
        });
    }
    result
}

#[derive(Debug, Serialize)]
pub struct ApplyResult {
    pub agent_key: String,
    pub file_name: String,
    pub success: bool,
    pub backup_name: Option<String>,
    pub error: Option<String>,
}

/// 应用同步：逐目标写盘（write_doc 自动备份）
pub fn apply_sync(
    snippet: &Snippet,
    targets: &[SyncTarget],
    remove: bool,
) -> Vec<ApplyResult> {
    preview_sync(snippet, targets, remove)
        .into_iter()
        .map(|p| {
            if (p.state == "synced" && !remove) || (remove && p.state == "not_synced") {
                return ApplyResult {
                    agent_key: p.agent_key,
                    file_name: p.file_name,
                    success: true,
                    backup_name: None,
                    error: None, // 无变化，跳过写入
                };
            }
            match write_doc(&p.agent_key, &p.file_name, &p.next_content) {
                Ok(w) => ApplyResult {
                    agent_key: p.agent_key,
                    file_name: p.file_name,
                    success: true,
                    backup_name: w.backup_name,
                    error: None,
                },
                Err(e) => ApplyResult {
                    agent_key: p.agent_key,
                    file_name: p.file_name,
                    success: false,
                    backup_name: None,
                    error: Some(e),
                },
            }
        })
        .collect()
}

// ---- 标记块操作（行级，兼容 CRLF） ----

fn split_lines(content: &str) -> (Vec<String>, &'static str) {
    let eol = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let lines = content
        .lines()
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();
    (lines, eol)
}

fn extract_block(content: &str, id: &str) -> Option<String> {
    let begin = begin_marker(id);
    let (lines, _) = split_lines(content);
    let bi = lines.iter().position(|l| l.trim() == begin)?;
    let ei = lines[bi + 1..].iter().position(|l| l.trim() == END_MARKER)?;
    Some(lines[bi + 1..bi + 1 + ei].join("\n"))
}

fn upsert_block(content: &str, id: &str, block_content: &str) -> String {
    let begin = begin_marker(id);
    let (mut lines, eol) = split_lines(content);
    let block_lines: Vec<String> = std::iter::once(begin.clone())
        .chain(block_content.lines().map(|l| l.trim_end_matches('\r').to_string()))
        .chain(std::iter::once(END_MARKER.to_string()))
        .collect();

    if let Some(bi) = lines.iter().position(|l| l.trim() == begin) {
        if let Some(rel) = lines[bi + 1..].iter().position(|l| l.trim() == END_MARKER) {
            let ei = bi + 1 + rel;
            lines.splice(bi..=ei, block_lines);
            return lines.join(eol);
        }
    }
    // 追加：与正文空一行分隔
    if !lines.is_empty() && !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
        lines.push(String::new());
    }
    lines.extend(block_lines);
    lines.join(eol)
}

fn remove_block(content: &str, id: &str) -> String {
    let begin = begin_marker(id);
    let (mut lines, eol) = split_lines(content);
    if let Some(bi) = lines.iter().position(|l| l.trim() == begin) {
        if let Some(rel) = lines[bi + 1..].iter().position(|l| l.trim() == END_MARKER) {
            let ei = bi + 1 + rel;
            lines.drain(bi..=ei);
            // 清理块前可能遗留的空行
            while bi > 0
                && bi <= lines.len()
                && lines.get(bi).map(|l| l.is_empty()).unwrap_or(false)
                && lines.get(bi.wrapping_sub(1)).map(|l| l.is_empty()).unwrap_or(false)
            {
                lines.remove(bi);
            }
        }
    }
    lines.join(eol)
}

// ---- 打开/定位 ----

pub fn open_in_editor(agent_key: &str, file_name: &str) -> Result<(), String> {
    let path = resolve_path(agent_key, file_name)?;
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }
    opener::open(&path).map_err(|e| format!("无法打开: {}", e))
}

pub fn reveal_in_folder(agent_key: &str, file_name: &str) -> Result<(), String> {
    let path = resolve_path(agent_key, file_name)?;
    let target = if path.exists() {
        path
    } else {
        path.parent().map(Path::to_path_buf).unwrap_or(path)
    };
    #[cfg(target_os = "windows")]
    {
        if target.is_file() {
            std::process::Command::new("explorer")
                .args(["/select,", &target.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {}", e))?;
            return Ok(());
        }
    }
    opener::open(&target).map_err(|e| format!("无法打开目录: {}", e))
}

// ---- unit tests ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_upsert_appends_block() {
        let doc = "# 我的规则\n\n手写内容。";
        let out = upsert_block(doc, "base", "规则A\n规则B");
        assert!(out.contains("<!-- SKILLMAN:SYNC base -->"));
        assert!(out.contains("规则A"));
        assert!(out.ends_with("<!-- SKILLMAN:END -->"));
        // 手写内容保留
        assert!(out.contains("手写内容。"));
    }

    #[test]
    fn test_upsert_replaces_existing_block() {
        let doc = "前言\n<!-- SKILLMAN:SYNC base -->\n旧内容\n<!-- SKILLMAN:END -->\n后记";
        let out = upsert_block(doc, "base", "新内容");
        assert!(out.contains("新内容"));
        assert!(!out.contains("旧内容"));
        assert!(out.contains("前言"));
        assert!(out.contains("后记"));
        // 只有一对标记
        assert_eq!(out.matches("SKILLMAN:SYNC base").count(), 1);
    }

    #[test]
    fn test_remove_block() {
        let doc = "前言\n\n<!-- SKILLMAN:SYNC base -->\n内容\n<!-- SKILLMAN:END -->\n后记";
        let out = remove_block(doc, "base");
        assert!(!out.contains("SKILLMAN"));
        assert!(out.contains("前言"));
        assert!(out.contains("后记"));
    }

    #[test]
    fn test_extract_block() {
        let doc = "x\n<!-- SKILLMAN:SYNC s1 -->\n行1\n行2\n<!-- SKILLMAN:END -->";
        assert_eq!(extract_block(doc, "s1").unwrap(), "行1\n行2");
        assert!(extract_block(doc, "nope").is_none());
    }

    #[test]
    fn test_crlf_preserved() {
        let doc = "甲\r\n乙\r\n";
        let out = upsert_block(doc, "k", "丙");
        assert!(out.contains("\r\n"), "应保持 CRLF 换行");
        assert!(out.starts_with("甲\r\n乙"));
    }

    #[test]
    fn test_backup_name_validation() {
        assert!(is_valid_backup_name("CLAUDE.md", "CLAUDE.md.20260811-143022"));
        assert!(!is_valid_backup_name("CLAUDE.md", "CLAUDE.md.evil"));
        assert!(!is_valid_backup_name("CLAUDE.md", "../etc/passwd"));
        assert!(!is_valid_backup_name("CLAUDE.md", "CLAUDE.md.2026081-143022"));
    }

    #[test]
    fn test_snippet_frontmatter() {
        let (name, body) = parse_snippet_frontmatter("---\nname: 基础规则\n---\n内容行", "x");
        assert_eq!(name, "基础规则");
        assert_eq!(body, "内容行");
        let (name2, _) = parse_snippet_frontmatter("无 frontmatter", "fallback");
        assert_eq!(name2, "fallback");
    }

    #[test]
    fn test_idempotent_sync() {
        let doc = "正文";
        let once = upsert_block(doc, "s", "块");
        let twice = upsert_block(&once, "s", "块");
        assert_eq!(once, twice, "重复同步同一内容应幂等");
    }
}
