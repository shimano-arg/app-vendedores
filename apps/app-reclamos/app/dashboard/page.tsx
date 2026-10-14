import { redirect } from 'next/navigation';
import { CLAIM_COLUMNS, COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';
import { createClient } from '@/lib/supabase/server';
import { DashboardCharts } from './DashboardCharts';
import { KpiCard } from './KpiCard';

// v1265 (2026-10-13): dashboard de métricas. Server Component con revalidate
// 5min. Gate admin via check role en profiles. KPIs + 2 charts livianos.
// Pensado para volumen ~20 claims/semana, queries agregadas simples sobre
// claims + claim_events. Sin materialized views.
export const revalidate = 300;

type Claim = {
  id: number;
  current_column: string;
  claim_type: string | null;
  created_at: string;
  updated_at: string;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'admin') redirect('/board');

  // Query todos los claims — con volumen chico es OK, sino filtramos por fecha.
  const { data: claimsRaw } = await supabase
    .from('claims')
    .select('id, current_column, claim_type, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(5000);
  const claims = (claimsRaw ?? []) as Claim[];

  // KPIs
  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const abiertos = claims.filter(
    (c) => !['resuelto', 'cerrado'].includes(c.current_column),
  ).length;
  const cerradosMes = claims.filter(
    (c) =>
      c.current_column === 'cerrado' && new Date(c.updated_at).getTime() >= monthStartMs,
  ).length;

  // Tiempo promedio resolución últimos 30d: closed claims con updated - created
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
  const closedRecent = claims.filter(
    (c) =>
      c.current_column === 'cerrado' && new Date(c.updated_at).getTime() >= thirtyDaysAgo,
  );
  const avgResolHours =
    closedRecent.length > 0
      ? Math.round(
          closedRecent.reduce(
            (sum, c) =>
              sum + (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()),
            0,
          ) /
            closedRecent.length /
            36e5,
        )
      : 0;

  // Backlog aging p75: para claims abiertos, computar horas desde updated_at.
  const openAges = claims
    .filter((c) => !['resuelto', 'cerrado'].includes(c.current_column))
    .map((c) => (now - new Date(c.updated_at).getTime()) / 36e5)
    .sort((a, b) => a - b);
  const p75 =
    openAges.length > 0
      ? Math.round(openAges[Math.floor(openAges.length * 0.75)])
      : 0;

  // Chart 1: distribución por columna hoy (barras).
  const flowToday = CLAIM_COLUMNS.filter(
    (c) => !['resuelto', 'cerrado'].includes(c.key),
  ).map((col) => ({
    name: col.label,
    value: claims.filter((cl) => cl.current_column === col.key).length,
  }));

  // Chart 2: trend 4 semanas (nuevos vs resueltos).
  const weeks: { week: string; nuevos: number; resueltos: number }[] = [];
  for (let i = 3; i >= 0; i--) {
    const weekEnd = new Date();
    weekEnd.setHours(23, 59, 59, 999);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const startMs = weekStart.getTime();
    const endMs = weekEnd.getTime();
    const nuevos = claims.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return t >= startMs && t <= endMs;
    }).length;
    const resueltos = claims.filter((c) => {
      if (c.current_column !== 'cerrado') return false;
      const t = new Date(c.updated_at).getTime();
      return t >= startMs && t <= endMs;
    }).length;
    const label = `${weekStart.getDate()}/${weekStart.getMonth() + 1}`;
    weeks.push({ week: label, nuevos, resueltos });
  }

  return (
    <main className="page-bg page-bg-board min-h-[calc(100vh-56px)] px-6 py-6 lg:py-8">
      <div className="mb-6">
        <p className="eyebrow mb-1">Dashboard</p>
        <h1 className="display text-2xl">Métricas de reclamos</h1>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Abiertos ahora" value={abiertos} hint="todos los no cerrados" />
        <KpiCard
          label="Cerrados este mes"
          value={cerradosMes}
          hint="desde el día 1"
        />
        <KpiCard
          label="Promedio resolución"
          value={avgResolHours}
          suffix="hs"
          hint="últimos 30 días"
        />
        <KpiCard
          label="Backlog aging p75"
          value={p75}
          suffix="hs"
          hint="75% del backlog es más joven"
        />
      </section>

      <DashboardCharts flowToday={flowToday} weeks={weeks} columnLabels={COLUMN_LABEL as Record<ClaimColumn, string>} />
    </main>
  );
}
