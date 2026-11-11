import { useEffect, useRef, useState } from "react";

interface Tip {
  x: number;
  y: number;
  text: string;
}

const DELAY_MS = 260;

/** 这些元素不需要 tooltip：拖拽区/窗口按钮的标题是视觉噪音，空状态等纯文本
 *  容器的 title 只是对已可见内容的重复。仅精确排除，不用 tag 泛化，
 *  避免误伤 tag/统计 chip/路径提示等有信息价值的 tooltip。 */
function shouldSkip(el: HTMLElement): boolean {
  if (el.hasAttribute("data-no-tooltip")) return true;
  if (el.dataset.role === "draggable") return true;
  // 窗口控制按钮（最小化/最大化/关闭）标题已是图标旁文本，且 hover 即触发
  if (el.classList.contains("win-btn")) return true;
  // 空状态：图标+标题+描述已全部可见，title 无补充信息
  if (el.classList.contains("empty-state")) return true;
  return false;
}

/** 全局 tooltip：事件委托接管 [title]，渲染为圆角暗色浮层。
 *  带 260ms 延迟（鼠标停留一小会才出现），移出即取消；
 *  长文字自动换行；离开后恢复 title 属性、无 DOM 残留。 */
export function GlobalTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const stateRef = useRef<{ el: HTMLElement | null; title: string | null }>({
    el: null,
    title: null,
  });

  useEffect(() => {
    const state = stateRef.current;

    const clearTimer = () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const restore = () => {
      clearTimer();
      if (state.el && state.title != null) {
        state.el.setAttribute("title", state.title);
      }
      state.el = null;
      state.title = null;
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") return;
      const el = target.closest<HTMLElement>("[title]");
      if (!el || el === state.el) return;

      // 切到新元素前清掉上一个
      restore();
      const title = el.getAttribute("title")?.trim();
      if (!title) return;
      if (shouldSkip(el)) return;

      state.el = el;
      state.title = title;
      el.removeAttribute("title"); // 禁用原生白底提示，避免两者并存
      timerRef.current = window.setTimeout(() => {
        setTip({ x: e.clientX, y: e.clientY, text: title });
      }, DELAY_MS);
    };

    const onOut = (e: MouseEvent) => {
      if (!state.el) return;
      const rel = e.relatedTarget as Node | null;
      if (rel && state.el.contains(rel)) return; // 仍在元素内（移到子节点）
      restore();
    };

    const onKey = () => restore();

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("keydown", onKey);
      restore();
    };
  }, []);

  // 跟随鼠标，偏移避免遮挡
  useEffect(() => {
    const el = elRef.current;
    if (!el || !tip) return;
    const pad = 12;
    const { innerWidth, innerHeight } = window;
    const r = el.getBoundingClientRect();
    let x = tip.x + pad;
    let y = tip.y + pad;
    if (x + r.width > innerWidth - 8) x = tip.x - r.width - pad;
    if (y + r.height > innerHeight - 8) y = tip.y - r.height - pad;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      ref={elRef}
      className="global-tooltip"
      role="tooltip"
      style={{
        left: tip.x + 12,
        top: tip.y + 12,
      }}
    >
      {tip.text.split("\n").map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
