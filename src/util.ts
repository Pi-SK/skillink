// 通用格式化工具

/** unix 秒 → "2026-08-11 14:30" */
export function fmtTime(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** 相对时间："刚刚 / 5 分钟前 / 3 小时前 / 2 天前"，更久用日期 */
export function fmtRelTime(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtTime(unixSeconds).slice(0, 10);
}

/** 字节数 → 可读大小 */
export function fmtSize(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
