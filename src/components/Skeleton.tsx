export function MatrixSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="skeleton-wrap" aria-busy="true">
      <div className="skeleton-bar" style={{ width: "40%" }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i} style={{ opacity: 1 - i * 0.09 }}>
          <div className="skeleton-cell" style={{ width: 220 }} />
          <div className="skeleton-cell" style={{ width: 90 }} />
          {Array.from({ length: 5 }).map((_, j) => (
            <div className="skeleton-dot" key={j} />
          ))}
        </div>
      ))}
    </div>
  );
}
