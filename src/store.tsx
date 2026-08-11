// 数据层：统一持有快照状态，toggle 后增量更新，避免全量重扫
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentStatus,
  SkillInfo,
  MatrixCell,
  PluginInfo,
  PluginCell,
} from "./types";
import * as api from "./api";
import { useToast } from "./components/Toast";

interface DataState {
  agents: AgentStatus[];
  skills: SkillInfo[];
  matrix: MatrixCell[];
  plugins: PluginInfo[];
  pluginMatrix: PluginCell[];
  loading: boolean;
  /** 正在同步中的 cell key 集合（skill: agent::source::id / plugin: agent::name） */
  toggling: Set<string>;
  reload: () => Promise<void>;
  toggleSkill: (
    agentKey: string,
    skillId: string,
    source: string,
    enable: boolean
  ) => Promise<void>;
  togglePlugin: (agentKey: string, pluginName: string, enable: boolean) => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData 必须在 DataProvider 内使用");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [matrix, setMatrix] = useState<MatrixCell[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginMatrix, setPluginMatrix] = useState<PluginCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const { push } = useToast();

  const reload = useCallback(async () => {
    try {
      const [a, s, m, p, pm] = await Promise.all([
        api.getAgents(),
        api.getSkills(),
        api.getMatrix(),
        api.getPlugins(),
        api.getPluginMatrix(),
      ]);
      setAgents(a);
      setSkills(s);
      setMatrix(m);
      setPlugins(p);
      setPluginMatrix(pm);
    } catch (e) {
      push(`加载数据失败: ${String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    reload();
  }, [reload]);

  const markToggling = useCallback((key: string, on: boolean) => {
    setToggling((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleSkill = useCallback(
    async (agentKey: string, skillId: string, source: string, enable: boolean) => {
      const key = `${agentKey}::${source}::${skillId}`;
      markToggling(key, true);
      try {
        const pluginName = source !== "独立" ? source : undefined;
        const res = await api.toggleSkill(agentKey, skillId, enable, pluginName);
        if (res.success) {
          // 增量更新，不触发全量重扫
          setMatrix((prev) =>
            prev.map((c) =>
              c.agent_key === agentKey && c.skill_id === skillId && c.source === source
                ? { ...c, linked: enable }
                : c
            )
          );
          push(
            enable ? `已链接 ${skillId} → ${agentKey}（${res.mode_used}）` : `已断开 ${skillId} ↔ ${agentKey}`,
            "success"
          );
          // copy 模式下副本与源不再实时同步，提示一次
          if (enable && res.mode_used === "copy") {
            push("该 Agent 使用 copy 模式，后续源更新不会自动同步", "info");
          }
        } else {
          push(res.error || "同步失败", "error");
          await reload();
        }
      } catch (e) {
        push(String(e), "error");
        await reload();
      } finally {
        markToggling(key, false);
      }
    },
    [markToggling, push, reload]
  );

  const togglePlugin = useCallback(
    async (agentKey: string, pluginName: string, enable: boolean) => {
      const key = `plugin::${agentKey}::${pluginName}`;
      markToggling(key, true);
      try {
        const res = await api.togglePlugin(agentKey, pluginName, enable);
        if (res.success) {
          setPluginMatrix((prev) =>
            prev.map((c) =>
              c.agent_key === agentKey && c.plugin_name === pluginName
                ? { ...c, linked: enable }
                : c
            )
          );
          push(
            enable ? `已同步插件 ${pluginName} → ${agentKey}` : `已移除插件 ${pluginName} ↔ ${agentKey}`,
            "success"
          );
        } else {
          push(res.error || "同步失败", "error");
          await reload();
        }
      } catch (e) {
        push(String(e), "error");
        await reload();
      } finally {
        markToggling(key, false);
      }
    },
    [markToggling, push, reload]
  );

  return (
    <DataContext.Provider
      value={{
        agents,
        skills,
        matrix,
        plugins,
        pluginMatrix,
        loading,
        toggling,
        reload,
        toggleSkill,
        togglePlugin,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
