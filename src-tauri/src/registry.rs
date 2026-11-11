use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDef {
    pub key: String,
    pub display_name: String,
    pub skills_dir: String,
    #[serde(default)]
    pub plugins_dir: Option<String>,
    pub detect_dir: String,
    #[serde(default = "default_sync_mode")]
    pub sync_mode: String,
    #[serde(default)]
    pub ignored: bool,
}

fn default_sync_mode() -> String {
    "auto".into()
}

/// 14 个内置 Agent 预设（含 QwenWork CN / QoderWork CN / Qoder CN / OpenCode / ZCode / Pi）
pub fn builtin_agents() -> Vec<AgentDef> {
    vec![
        AgentDef { key: "codex".into(), display_name: "Codex".into(), skills_dir: "~/.codex/skills".into(), plugins_dir: None, detect_dir: "~/.codex".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "claude".into(), display_name: "Claude Code".into(), skills_dir: "~/.claude/skills".into(), plugins_dir: Some("~/.claude/plugins/data".into()), detect_dir: "~/.claude".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "qoder".into(), display_name: "Qoder".into(), skills_dir: "~/.qoder/skills".into(), plugins_dir: Some("~/.qoder/plugins".into()), detect_dir: "~/.qoder".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "qodercn".into(), display_name: "Qoder CN".into(), skills_dir: "~/.qoder-cn/skills".into(), plugins_dir: None, detect_dir: "~/.qoder-cn".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "opencode".into(), display_name: "OpenCode".into(), skills_dir: "~/.config/opencode/skills".into(), plugins_dir: None, detect_dir: "~/.config/opencode".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "zcode".into(), display_name: "ZCode".into(), skills_dir: "~/.zcode/skills".into(), plugins_dir: None, detect_dir: "~/.zcode".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "pi".into(), display_name: "Pi".into(), skills_dir: "~/.pi/agent/skills".into(), plugins_dir: None, detect_dir: "~/.pi/agent".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "qwenworkcn".into(), display_name: "QwenWork CN".into(), skills_dir: "~/.qwenworkcn/skills".into(), plugins_dir: Some("~/.qwenworkcn/plugins-custom".into()), detect_dir: "~/.qwenworkcn".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "qoderworkcn".into(), display_name: "QoderWork CN".into(), skills_dir: "~/.qoderworkcn/skills".into(), plugins_dir: Some("~/.qoderworkcn/plugins-custom".into()), detect_dir: "~/.qoderworkcn".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "qoderwork".into(), display_name: "QoderWork (旧版)".into(), skills_dir: "~/.qoderwork/skills".into(), plugins_dir: None, detect_dir: "~/.qoderwork".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "trae".into(), display_name: "Trae".into(), skills_dir: "~/.trae/skills".into(), plugins_dir: None, detect_dir: "~/.trae".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "trae-cn".into(), display_name: "Trae CN".into(), skills_dir: "~/.trae-cn/skills".into(), plugins_dir: None, detect_dir: "~/.trae-cn".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "copilot".into(), display_name: "GitHub Copilot".into(), skills_dir: "~/.copilot/skills".into(), plugins_dir: None, detect_dir: "~/.copilot".into(), sync_mode: "auto".into(), ignored: false },
        AgentDef { key: "agents".into(), display_name: ".agents/skills".into(), skills_dir: "~/.agents/skills".into(), plugins_dir: None, detect_dir: "~/.agents".into(), sync_mode: "auto".into(), ignored: false },
    ]
}

/// 用户自定义注册表路径: ~/.skillink/agents.json
pub fn user_agents_path() -> PathBuf {
    home_dir().join(".skillink").join("agents.json")
}

/// 加载合并后的 Agent 列表（user 覆盖 builtin）
pub fn load_all_agents() -> Vec<AgentDef> {
    let mut agents = builtin_agents();
    let user_path = user_agents_path();
    if user_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&user_path) {
            if let Ok(user_agents) = serde_json::from_str::<Vec<AgentDef>>(&content) {
                for ua in user_agents {
                    if let Some(existing) = agents.iter_mut().find(|a| a.key == ua.key) {
                        *existing = ua;
                    } else {
                        agents.push(ua);
                    }
                }
            }
        }
    }
    agents
}

/// 获取 home 目录 (Windows: USERPROFILE)
pub fn home_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// 展开 ~ 为 home 目录
pub fn expand_tilde(path: &str) -> PathBuf {
    let home = home_dir();
    if path.starts_with("~/") {
        home.join(&path[2..])
    } else {
        PathBuf::from(path)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStatus {
    pub key: String,
    pub display_name: String,
    pub detected: bool,
    pub skills_dir: String,
    pub plugins_dir: Option<String>,
    pub sync_mode: String,
    pub ignored: bool,
}
