interface ToggleProps {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
}

/** 自定义 pill 开关，替代原生 checkbox */
export function Toggle({ checked, disabled, busy, title, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? "on" : ""} ${busy ? "busy" : ""}`}
      disabled={disabled || busy}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="knob" />
    </button>
  );
}
