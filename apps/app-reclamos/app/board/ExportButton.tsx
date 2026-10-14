'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';

// v1264 (2026-10-13): botón de export CSV / xlsx desde el header del board.
// Dos opciones: Excel (xlsx multi-hoja con header azul Shimano) o CSV plano.
// Default sin filtros = todos los reclamos. Si se agregan filtros via URL
// query params el endpoint los respeta. Visible solo si pasa gate admin.
export function ExportButton({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;

  function exportFormat(format: 'csv' | 'xlsx') {
    window.open(`/api/export?format=${format}`, '_blank');
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pill-outline"
        title="Exportar reclamos"
      >
        <Download className="h-3.5 w-3.5" />
        <span>Exportar</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1.5 z-[91] sheet-panel py-1.5 min-w-[160px]">
            <button
              type="button"
              onClick={() => exportFormat('xlsx')}
              className="w-full px-3 py-2 text-left text-[13px] hover:bg-[rgba(0,0,0,0.04)] text-[color:var(--text-primary)]"
            >
              Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => exportFormat('csv')}
              className="w-full px-3 py-2 text-left text-[13px] hover:bg-[rgba(0,0,0,0.04)] text-[color:var(--text-primary)]"
            >
              CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
