import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2, Package, Sparkles } from "lucide-react";
import { Drawer } from "./Drawer";
import { Toggle } from "./Toggle";
import { Markdown } from "./Markdown";
import { useData } from "../store";
import { useToast } from "./Toast";
import { readSkillMd, openSkillFolder } from "../api";
import { isTauri } from "../mock";
import type { SkillInfo } from "../types";

interface SkillDrawerProps {
  skill: SkillInfo | null;
  onClose: () => void;
}

/** 技能详情抽屉：SKILL.md 预览 + 各 Agent 链接开关 */
export function SkillDrawer({ skill, onClose }: SkillDrawerProps) {
  const { agents, matrix, toggling, toggleSkill } = useData();
  const { push } = useToast();
  const [md, setMd] = useState<string>("");
  const [loadingMd, setLoadingMd] = useState(false);

  const targetAgents = useMemo(() => agents.filter((a) => a.key !== "agents"), [agents]);

  useEffect(() => {
    if (!skill) return;
    setMd("");
    if (!isTauri) {
      setMd(`# ${skill.name}\n\n> 桌面端将显示真实 SKILL.md 内容。\n\n${skill.description || ""}`);
      return;
    }
    let cancelled = false;
    setLoadingMd(true);
    const pluginName = skill.source !== "独立" ? skill.source : undefined;
    readSkillMd(skill.id, pluginName)
      .then((text) => {
        if (!cancelled) setMd(text);
      })
      .catch((e) => {
        if (!cancelled) setMd(`*读取失败：${String(e)}*`);
      })
      .finally(() => {
        if (!cancelled) setLoadingMd(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill]);

  const linkedAgents = useMemo(() => {
    if (!skill) return new Set<string>();
    const s = new Set<string>();
    for (const c of matrix) {
      if (c.skill_id === skill.id && c.source === skill.source && c.linked) {
        s.add(c.agent_key);
      }
    }
    return s;
  }, [matrix, skill]);

  const openFolder = () => {
    if (!skill) return;
    if (!isTauri) {
      push("仅在桌面端可用", "info");
      return;
    }
    const pluginName = skill.source !== "独立" ? skill.source : undefined;
    openSkillFolder(skill.id, pluginName).catch((e) => push(String(e), "error"));
  };

  return (
    <Drawer
      open={skill !== null}
      onClose={onClose}
      title={
        skill ? (
          <span className="drawer-skill-title">
            {skill.source === "独立" ? (
              <Sparkles size={15} className="group-icon-standalone" />
            ) : (
              <Package size={15} className="group-icon-plugin" />
            )}
            {skill.name}
          </span>
        ) : (
          ""
        )
      }
      footer={
        skill && (
          <button className="btn" onClick={openFolder}>
            <FolderOpen size={14} />
            打开源目录
          </button>
        )
      }
    >
      {skill && (
        <>
          <div className="skill-drawer-meta">
            <div className="meta-row">
              <span className="meta-label">id</span>
              <code>{skill.id}</code>
            </div>
            <div className="meta-row">
              <span className="meta-label">来源</span>
              {skill.source === "独立" ? (
                <span className="tag tag-standalone">独立技能</span>
              ) : (
                <span className="tag tag-plugin">插件 · {skill.source}</span>
              )}
            </div>
            {skill.description && (
              <div className="meta-row">
                <span className="meta-label">简介</span>
                <span className="meta-value">{skill.description}</span>
              </div>
            )}
          </div>

          <div className="skill-drawer-section">
            <div className="section-label">链接状态</div>
            <div className="drawer-agent-rows">
              {targetAgents.map((agent) => {
                const linked = linkedAgents.has(agent.key);
                const busy = toggling.has(`${agent.key}::${skill.source}::${skill.id}`);
                return (
                  <div className="plugin-agent-row" key={agent.key}>
                    <span className={`status-dot ${agent.detected ? "on" : ""}`} />
                    <span className={`plugin-agent-name ${agent.detected ? "" : "dim"}`}>
                      {agent.display_name}
                    </span>
                    {!agent.detected && <span className="dim-hint">未安装</span>}
                    <div className="toolbar-spacer" />
                    <Toggle
                      checked={linked}
                      busy={busy}
                      disabled={!agent.detected}
                      onChange={(next) => toggleSkill(agent.key, skill.id, skill.source, next)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="skill-drawer-section">
            <div className="section-label">SKILL.md</div>
            <div className="skill-md-box">
              {loadingMd ? (
                <div className="docs-loading">
                  <Loader2 size={15} className="spin" /> 读取中…
                </div>
              ) : (
                <Markdown content={md} />
              )}
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}
