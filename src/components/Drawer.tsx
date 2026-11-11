import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** 右侧滑入抽屉：打开时聚焦关闭按钮并限制焦点在抽屉内，关闭时归还焦点 */
export function Drawer({ open, onClose, title, children, footer }: DrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // 焦点陷阱：Tab 循环限制在抽屉内
      if (e.key === "Tab" && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // 记录打开前的触发元素，关闭时归还焦点
    const prevActive = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prevActive?.focus?.();
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={`drawer-overlay ${open ? "open" : ""}`}
        onMouseDown={onClose}
      />
      <aside className={`drawer ${open ? "open" : ""}`} ref={drawerRef} aria-modal="true" role="dialog">
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button ref={closeBtnRef} className="btn-icon" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>
  );
}
