import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * 离场守卫：编辑器组件上报「是否有未保存更改」，导航动作在存在脏状态时
 * 先弹确认对话框，用户确认丢弃后才执行。避免切换页面/子标签/片段时静默丢内容。
 */
interface NavigationGuardCtxValue {
  /** 上报某个作用域（如 docs / snippets）当前是否有未保存更改 */
  setDirty: (scope: string, dirty: boolean) => void;
  /** 包装一个导航动作：无脏状态则立即执行，否则弹确认 */
  guard: (action: () => void) => void;
}

const NavigationGuardCtx = createContext<NavigationGuardCtxValue>({
  setDirty: () => {},
  guard: (action) => action(),
});

export function useNavigationGuard() {
  return useContext(NavigationGuardCtx);
}

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  // 用 ref 存脏作用域与待执行动作，避免函数 setState 的 updater 歧义
  const dirtyScopes = useRef<Set<string>>(new Set());
  const pendingAction = useRef<(() => void) | null>(null);
  const [show, setShow] = useState(false);

  const setDirty = useCallback((scope: string, dirty: boolean) => {
    if (dirty) dirtyScopes.current.add(scope);
    else dirtyScopes.current.delete(scope);
  }, []);

  const guard = useCallback((action: () => void) => {
    if (dirtyScopes.current.size === 0) {
      action();
      return;
    }
    pendingAction.current = action;
    setShow(true);
  }, []);

  const confirm = useCallback(() => {
    dirtyScopes.current.clear();
    const action = pendingAction.current;
    pendingAction.current = null;
    setShow(false);
    action?.();
  }, []);

  const cancel = useCallback(() => {
    pendingAction.current = null;
    setShow(false);
  }, []);

  return (
    <NavigationGuardCtx.Provider value={{ setDirty, guard }}>
      {children}
      <ConfirmDialog
        open={show}
        title="有未保存的更改"
        message="离开将丢弃当前未保存的修改，确定继续吗？"
        confirmText="丢弃并离开"
        danger
        onConfirm={confirm}
        onCancel={cancel}
      />
    </NavigationGuardCtx.Provider>
  );
}
