'use client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ClaimColumn } from '@/lib/columns';

// v1265 (2026-10-13): charts del dashboard. Client component (recharts
// requiere window). Estilo minimalista Apple con tokens de color.
export function DashboardCharts({
  flowToday,
  weeks,
  columnLabels: _columnLabels,
}: {
  flowToday: { name: string; value: number }[];
  weeks: { week: string; nuevos: number; resueltos: number }[];
  columnLabels: Record<ClaimColumn, string>;
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card-elevated p-4">
        <p className="eyebrow mb-3">Flujo hoy — abiertos por columna</p>
        <div className="h-[240px]">
          <ResponsiveContainer>
            <BarChart data={flowToday} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.08)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6E6E73' }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: '#6E6E73' }}
                width={110}
              />
              <Tooltip
                contentStyle={{
                  background: '#FFFFFF',
                  border: '1px solid rgba(60,60,67,0.14)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
                cursor={{ fill: 'rgba(0,113,227,0.05)' }}
              />
              <Bar dataKey="value" fill="#0071E3" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-elevated p-4">
        <p className="eyebrow mb-3">Últimas 4 semanas — nuevos vs resueltos</p>
        <div className="h-[240px]">
          <ResponsiveContainer>
            <LineChart data={weeks}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.08)" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#6E6E73' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6E6E73' }} />
              <Tooltip
                contentStyle={{
                  background: '#FFFFFF',
                  border: '1px solid rgba(60,60,67,0.14)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                iconType="circle"
                iconSize={8}
              />
              <Line
                type="monotone"
                dataKey="nuevos"
                stroke="#0071E3"
                strokeWidth={2.2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="resueltos"
                stroke="#30D158"
                strokeWidth={2.2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
