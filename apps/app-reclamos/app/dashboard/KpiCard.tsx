// v1265 (2026-10-13): KPI widget con eyebrow + número grande + hint pequeño.
// Estilo Apple: card-elevated, display font para el valor.
export function KpiCard({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="card-elevated p-4">
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="display text-3xl tabular-nums">{value}</span>
        {suffix && (
          <span className="text-sm font-medium text-[color:var(--text-secondary)]">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[11px] text-[color:var(--text-tertiary)] mt-1">{hint}</p>
      )}
    </div>
  );
}
