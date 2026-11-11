import {
  Bot,
  Code2,
  Cpu,
  GitBranch,
  MessageSquare,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  claude: MessageSquare,
  codex: Code2,
  qoder: Cpu,
  qwenworkcn: Sparkles,
  qoderworkcn: Cpu,
  qoderwork: Cpu,
  trae: Zap,
  "trae-cn": Zap,
  copilot: GitBranch,
};

/** 根据 agent key 返回对应的 lucide 图标，未匹配的 fallback 为 Bot */
export function getAgentIcon(key: string): LucideIcon {
  return ICON_MAP[key] ?? Bot;
}

/** 各平台主题色（用于图标着色），未匹配的 fallback 为 accent */
export function getAgentColor(key: string): string {
  const map: Record<string, string> = {
    claude: "#d4a574",
    codex: "#10a37f",
    copilot: "#8b949e",
  };
  return map[key] ?? "var(--accent)";
}
