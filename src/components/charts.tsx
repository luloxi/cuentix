const PALETTE = [
  "#e2a23b",
  "#d86b4a",
  "#8fbf7a",
  "#6aa8a1",
  "#d3c36a",
  "#c47b8a",
  "#7f93b0",
  "#c4a07a",
  "#9aaf6a",
  "#d08a5a",
  "#6e8b74",
  "#b7a3c9",
];

export function chartColor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

export function PieChart({ slices }: { slices: { label: string; value: number }[] }) {
  const parts = slices.filter((slice) => slice.value > 0);
  const sum = parts.reduce((total, slice) => total + slice.value, 0);
  if (sum <= 0) return <p className="muted">Sin datos para el gráfico.</p>;
  if (parts.length === 1) {
    return (
      <svg viewBox="0 0 200 200" className="chart" role="img" aria-label={parts[0]!.label}>
        <circle cx="100" cy="100" r="78" fill={chartColor(0)} />
      </svg>
    );
  }
  let angle = -Math.PI / 2;
  const radius = 78;
  const paths = parts.map((slice, index) => {
    const sweep = (slice.value / sum) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    const x1 = 100 + radius * Math.cos(start);
    const y1 = 100 + radius * Math.sin(start);
    const x2 = 100 + radius * Math.cos(angle);
    const y2 = 100 + radius * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M 100 100 L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
    return (
      <path key={slice.label} d={d} fill={chartColor(index)}>
        <title>{slice.label}</title>
      </path>
    );
  });
  return (
    <svg viewBox="0 0 200 200" className="chart" role="img" aria-label="Distribución por categoría">
      {paths}
    </svg>
  );
}

export function BarChart({ rows }: { rows: { label: string; value: number }[] }) {
  const positive = rows.filter((row) => row.value !== 0);
  if (positive.length === 0) return <p className="muted">Sin datos para el gráfico.</p>;
  const max = Math.max(...positive.map((row) => Math.abs(row.value)), 1);
  const width = Math.max(640, positive.length * 48);
  const height = 240;
  const pad = { l: 12, r: 12, t: 12, b: 40 };
  const inner = height - pad.t - pad.b;
  const slot = (width - pad.l - pad.r) / positive.length;
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart wide" role="img" aria-label="Barras por mes" style={{ minWidth: width / 2 }}>
        {positive.map((row, index) => {
          const barHeight = (Math.abs(row.value) / max) * (inner - 8);
          const x = pad.l + index * slot + slot * 0.18;
          const y = pad.t + inner - barHeight;
          return (
            <g key={row.label}>
              <rect x={x} y={y} width={slot * 0.64} height={barHeight} rx="4" fill={chartColor(index)} />
              <text x={x + slot * 0.32} y={height - 14} textAnchor="middle" className="chart-label">
                {row.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LineChart({
  series,
  ariaLabel,
}: {
  series: { name: string; points: { x: string; y: number }[] }[];
  ariaLabel: string;
}) {
  const xs = [...new Set(series.flatMap((item) => item.points.map((point) => point.x)))].sort();
  if (xs.length === 0) return <p className="muted">Sin datos para el gráfico.</p>;
  const ys = series.flatMap((item) => item.points.map((point) => point.y));
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(...ys, 0);
  const span = maxY - minY || 1;
  const width = 640;
  const height = 260;
  const pad = { l: 56, r: 16, t: 16, b: 36 };
  const xAt = (value: string) => {
    const index = xs.indexOf(value);
    if (xs.length === 1) return (pad.l + width - pad.r) / 2;
    return pad.l + (index / (xs.length - 1)) * (width - pad.l - pad.r);
  };
  const yAt = (value: number) => pad.t + (1 - (value - minY) / span) * (height - pad.t - pad.b);
  const ticks = [minY, minY + span / 2, maxY];
  const labelStep = Math.max(1, Math.ceil(xs.length / 6));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label={ariaLabel}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.l} x2={width - pad.r} y1={yAt(tick)} y2={yAt(tick)} className="grid-line" />
          <text x={pad.l - 8} y={yAt(tick) + 4} textAnchor="end" className="chart-label">
            {Math.round(tick)}
          </text>
        </g>
      ))}
      {series.map((item, index) => {
        const ordered = [...item.points].sort((a, b) => a.x.localeCompare(b.x));
        if (ordered.length === 0) return null;
        const d = ordered.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xAt(point.x)} ${yAt(point.y)}`).join(" ");
        return (
          <g key={item.name}>
            <path d={d} fill="none" stroke={chartColor(index)} strokeWidth="2.5" />
            {ordered.map((point) => (
              <circle key={`${item.name}-${point.x}`} cx={xAt(point.x)} cy={yAt(point.y)} r="3.5" fill={chartColor(index)}>
                <title>
                  {item.name} {point.x}: {point.y}
                </title>
              </circle>
            ))}
          </g>
        );
      })}
      {xs.map((value, index) =>
        index % labelStep === 0 ? (
          <text key={value} x={xAt(value)} y={height - 10} textAnchor="middle" className="chart-label">
            {/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(2) : value}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="legend">
      {items.map((item, index) => (
        <li key={item.name}>
          <span className="swatch" style={{ background: chartColor(index) }} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}
