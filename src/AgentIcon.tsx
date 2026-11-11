/** 各 Agent 平台品牌图标（官方 logo 资源），用于矩阵开关与表头 */
import claudeLogo from "./assets/logos/claude.svg";
import codexLogo from "./assets/logos/codex.svg";
import qoderLogo from "./assets/logos/qoder.svg";
import qwenworkcnLogo from "./assets/logos/qwenworkcn.png";
import qoderworkcnLogo from "./assets/logos/qoderworkcn.svg";
import traeLogo from "./assets/logos/trae.svg";
import copilotLogo from "./assets/logos/copilot.svg";
import opencodeLogo from "./assets/logos/opencode.svg";
import zcodeLogo from "./assets/logos/zcode.svg";
import piLogo from "./assets/logos/pi.svg";

const LOGOS: Record<string, string> = {
  claude: claudeLogo,
  codex: codexLogo,
  qoder: qoderLogo,
  qwenworkcn: qwenworkcnLogo,
  qoderworkcn: qoderworkcnLogo,
  // 旧版 QoderWork 无独立 logo，沿用 Qoder 标识
  qoderwork: qoderLogo,
  // Qoder CN 无独立 logo 资源，沿用 Qoder 标识
  qodercn: qoderLogo,
  trae: traeLogo,
  "trae-cn": traeLogo,
  copilot: copilotLogo,
  opencode: opencodeLogo,
  zcode: zcodeLogo,
  pi: piLogo,
};

/** 无 logo 资源的兜底图形 */
function DefaultGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="var(--text-faint)" opacity="0.4" />
      <text
        x="8"
        y="12"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill="var(--bg)"
        fontFamily="sans-serif"
      >
        ?
      </text>
    </svg>
  );
}

export function AgentBrandIcon({
  agentKey,
  linked = false,
  size = 16,
  className,
}: {
  agentKey: string;
  linked?: boolean;
  size?: number;
  className?: string;
}) {
  const src = LOGOS[agentKey];
  return (
    <span
      className={`agent-icon-toggle ${linked ? "on" : ""}${className ? " " + className : ""}`}
      title={`${agentKey}${linked ? " · 已链接" : " · 未链接"}`}
    >
      {src ? (
        <img
          src={src}
          alt={agentKey}
          width={size}
          height={size}
          draggable={false}
          className={`agent-logo ${linked ? "" : "off"}`}
        />
      ) : (
        <DefaultGlyph size={size} />
      )}
    </span>
  );
}
