// 仅用于浏览器预览（非 Tauri 环境）的 mock 数据。
// 真实运行时所有数据来自 Rust invoke，本文件不参与生产逻辑。
import type {
  AgentStatus,
  SkillInfo,
  MatrixCell,
  PluginInfo,
  PluginCell,
  InstructionDoc,
  Snippet,
  UnmanagedItem,
  Issue,
} from "./types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const delay = <T,>(v: T): Promise<T> =>
  new Promise((r) => setTimeout(() => r(v), 120));

const agents: AgentStatus[] = [
  { key: "claude", display_name: "Claude Code", detected: true, skills_dir: "~/.claude/skills", plugins_dir: "~/.claude/plugins/data", sync_mode: "auto" },
  { key: "qwenworkcn", display_name: "QwenWork CN", detected: true, skills_dir: "~/.qwenworkcn/skills", plugins_dir: "~/.qwenworkcn/plugins-custom", sync_mode: "auto" },
  { key: "qoderworkcn", display_name: "QoderWork CN", detected: true, skills_dir: "~/.qoderworkcn/skills", plugins_dir: "~/.qoderworkcn/plugins-custom", sync_mode: "auto" },
  { key: "codex", display_name: "Codex", detected: true, skills_dir: "~/.codex/skills", plugins_dir: null, sync_mode: "auto" },
  { key: "copilot", display_name: "GitHub Copilot", detected: false, skills_dir: "~/.copilot/skills", plugins_dir: null, sync_mode: "auto" },
];

const skills: SkillInfo[] = [
  { id: "deep-research", name: "deep-research", description: "系统性深度调研：来源核验、三角互证、带引用的报告", source: "独立" },
  { id: "frontend-design", name: "frontend-design", description: "创建高设计质量的生产级前端界面", source: "独立" },
  { id: "paper-analyzer", name: "paper-analyzer", description: "将学术论文转化为深度 HTML 长文，6 轮强制工作流", source: "独立" },
  { id: "natural-writing", name: "natural-writing", description: "像人一样写作，去除语言模型痕迹", source: "独立" },
  { id: "pdf", name: "pdf", description: "PDF 读取、合并、拆分、旋转、水印、创建", source: "独立" },
  { id: "docx", name: "docx", description: "Word 文档端到端创建、读取、编辑", source: "独立" },
  { id: "audit", name: "audit", description: "改版项目体验走查、启发式评估", source: "product-design" },
  { id: "brief", name: "brief", description: "设计简报：一页纸对齐业务目标与设计标准", source: "product-design" },
  { id: "flow-web", name: "flow-web", description: "Web 端多屏 flow 与信息架构设计", source: "product-design" },
  { id: "synthesis", name: "synthesis", description: "跨来源整合、矛盾消解与缺口分析", source: "academic-research-skills" },
];

// 已链接集合: agent::source::skill
const linkedSet = new Set([
  "claude::独立::deep-research",
  "claude::独立::paper-analyzer",
  "claude::独立::pdf",
  "qwenworkcn::独立::deep-research",
  "qwenworkcn::独立::frontend-design",
  "qwenworkcn::独立::natural-writing",
  "qwenworkcn::独立::docx",
  "qwenworkcn::product-design::audit",
  "qwenworkcn::product-design::brief",
  "qoderworkcn::独立::deep-research",
  "qoderworkcn::独立::frontend-design",
  "qoderworkcn::独立::paper-analyzer",
  "qoderworkcn::product-design::flow-web",
  "qoderworkcn::academic-research-skills::synthesis",
]);

const matrix: MatrixCell[] = [];
for (const s of skills) {
  for (const a of agents) {
    matrix.push({
      agent_key: a.key,
      skill_id: s.id,
      source: s.source,
      linked: linkedSet.has(`${a.key}::${s.source}::${s.id}`),
    });
  }
}

const plugins: PluginInfo[] = [
  { name: "product-design", has_skills: true, skill_count: 3, description: "产品设计套件：简报 / 走查 / Flow / 情绪板" },
  { name: "academic-research-skills", has_skills: true, skill_count: 1, description: "学术研究全流程管线" },
];

const pluginLinked = new Set([
  "product-design::qwenworkcn",
  "product-design::qoderworkcn",
  "academic-research-skills::qoderworkcn",
]);

const pluginMatrix: PluginCell[] = [];
for (const p of plugins) {
  for (const a of agents.filter((x) => x.plugins_dir)) {
    pluginMatrix.push({
      agent_key: a.key,
      plugin_name: p.name,
      linked: pluginLinked.has(`${p.name}::${a.key}`),
    });
  }
}

const instructionDocs: InstructionDoc[] = [
  { agent_key: "claude", file_name: "CLAUDE.md", rel_path: ".claude/CLAUDE.md", role: "指令", editable: true, exists: true, size: 2048, modified: Math.floor(Date.now() / 1000) - 86400 },
  { agent_key: "codex", file_name: "AGENTS.md", rel_path: ".codex/AGENTS.md", role: "指令", editable: true, exists: true, size: 4096, modified: Math.floor(Date.now() / 1000) - 3600 },
  { agent_key: "qwenworkcn", file_name: "AGENTS.md", rel_path: ".qwenworkcn/awareness/main/AGENTS.md", role: "指令", editable: true, exists: true, size: 3100, modified: Math.floor(Date.now() / 1000) - 7200 },
  { agent_key: "qwenworkcn", file_name: "SOUL.md", rel_path: ".qwenworkcn/awareness/main/SOUL.md", role: "人格", editable: true, exists: true, size: 1200, modified: Math.floor(Date.now() / 1000) - 500 },
  { agent_key: "qwenworkcn", file_name: "USER.md", rel_path: ".qwenworkcn/awareness/main/USER.md", role: "用户画像", editable: true, exists: true, size: 800, modified: Math.floor(Date.now() / 1000) - 100 },
  { agent_key: "qwenworkcn", file_name: "MEMORY.md", rel_path: ".qwenworkcn/awareness/main/MEMORY.md", role: "记忆", editable: false, exists: true, size: 5980, modified: Math.floor(Date.now() / 1000) - 10 },
];

const mockDocContents = new Map<string, string>([
  ["claude::CLAUDE.md", "# Claude 全局指令\n\n- 先思考再编码\n- 简洁优先\n"],
  ["codex::AGENTS.md", "# Codex Agents\n\n## Coding Rules\n\n1. 外科手术式修改\n"],
  ["qwenworkcn::AGENTS.md", "# Instructions\n\n## Basic Info\n\n用户：研究生\n"],
  ["qwenworkcn::SOUL.md", "# SOUL - 协作风格\n\n深思熟虑，想清楚再动手。\n"],
  ["qwenworkcn::USER.md", "# User Profile\n\n重庆大学经管学院研究生\n"],
  ["qwenworkcn::MEMORY.md", "# MEMORY（只读）\n\n此文件由程序自动维护。\n"],
]);

const snippets: Snippet[] = [
  { id: "coding-rules", name: "通用编码规则", content: "- 编码前先思考\n- 简洁优先\n- 外科手术式修改\n- 目标驱动执行" },
  { id: "writing-style", name: "学术写作风格", content: "- 流畅、专业、严谨\n- 有据可依、边界清晰\n- 贡献克制，警惕过度宣称" },
];

let unmanagedItems: UnmanagedItem[] = [
  { agent_key: "qwenworkcn", kind: "skill", name: "lark-im", path: "~/.qwenworkcn/skills/lark-im", link_target: null, description: "发送飞书 IM 消息", source: "独立" },
  { agent_key: "qwenworkcn", kind: "skill", name: "lark-doc", path: "~/.qwenworkcn/skills/lark-doc", link_target: null, description: "创建与编辑飞书文档", source: "独立" },
  { agent_key: "qwenworkcn", kind: "skill", name: "brief", path: "~/.qwenworkcn/plugins/consulting-delivery/skills/brief", link_target: null, description: "项目简报生成", source: "consulting-delivery" },
  { agent_key: "qwenworkcn", kind: "plugin", name: "consulting-delivery", path: "~/.qwenworkcn/plugins/consulting-delivery", link_target: null, description: "咨询交付套件", source: "" },
  { agent_key: "claude", kind: "plugin", name: "claude-mem-inline", path: "~/.claude/plugins/data/claude-mem-inline", link_target: null, description: "内联记忆插件", source: "" },
  { agent_key: "qoderworkcn", kind: "skill", name: "xlsx", path: "~/.qoderworkcn/skills/xlsx", link_target: null, description: "Excel 表格处理", source: "独立" },
];

const issues: Issue[] = [
  { kind: "conflict", message: "技能 id「brief」存在多个来源：product-design、独立（链接时互相覆盖）", agent_key: null, skill_id: "brief" },
  { kind: "drift", message: "QoderWork CN 中的 docx 是 copy 副本且源已更新（副本落后）", agent_key: "qoderworkcn", skill_id: "docx" },
  { kind: "broken_link", message: "Claude Code 中的 old-skill 是断链（指向不存在的 ~/.agents/skills/old-skill）", agent_key: "claude", skill_id: "old-skill" },
];

export const mock = {
  getAgents: () => delay(agents),
  getSkills: () => delay(skills),
  getMatrix: () => delay(matrix),
  getPlugins: () => delay(plugins),
  getPluginMatrix: () => delay(pluginMatrix),
  getInstructionDocs: () => delay(instructionDocs),
  readInstructionDoc: (agentKey: string, fileName: string) =>
    delay(mockDocContents.get(`${agentKey}::${fileName}`) ?? ""),
  writeInstructionDoc: (agentKey: string, fileName: string, content: string) => {
    mockDocContents.set(`${agentKey}::${fileName}`, content);
    return delay({ backup_name: `${fileName}.20260811-000000`, bytes_written: content.length });
  },
  getSnippets: () => delay(snippets),
  getUnmanaged: () => delay(unmanagedItems),
  getIssues: () => delay(issues),
};

/** mock 纳管：从未纳管列表移除该项（模拟收编进 ~/.agents） */
export function mockAdopt(path: string) {
  unmanagedItems = unmanagedItems.filter((i) => i.path !== path);
}

/** 切换 mock 中的链接状态（模拟同步） */
export function mockToggleSkill(agentKey: string, skillId: string, source: string, enable: boolean) {
  const key = `${agentKey}::${source}::${skillId}`;
  if (enable) linkedSet.add(key);
  else linkedSet.delete(key);
  for (const c of matrix) {
    if (c.agent_key === agentKey && c.skill_id === skillId && c.source === source) {
      c.linked = enable;
    }
  }
}

export function mockTogglePlugin(pluginName: string, agentKey: string, enable: boolean) {
  const key = `${pluginName}::${agentKey}`;
  if (enable) pluginLinked.add(key);
  else pluginLinked.delete(key);
  for (const c of pluginMatrix) {
    if (c.agent_key === agentKey && c.plugin_name === pluginName) {
      c.linked = enable;
    }
  }
}
