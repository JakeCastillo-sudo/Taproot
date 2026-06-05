/**
 * QrCodesSettingsPage — /settings/qr-codes
 *
 * One QR code per table (plus a general menu code) pointing at the public
 * storefront /order/:slug[/table/:id]. QR images are rendered via a public QR
 * image service (no extra dependency). Download PNG per code; Print all.
 */

import { useQuery } from '@tanstack/react-query';
import { Download, Printer, QrCode } from 'lucide-react';
import { tables as tablesApi, settings as settingsApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';

function qrSrc(url: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
}

async function downloadPng(url: string, filename: string) {
  try {
    const res = await fetch(qrSrc(url, 600));
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = obj; a.download = filename; a.click();
    URL.revokeObjectURL(obj);
  } catch { showToast.error('Could not download QR code'); }
}

export function QrCodesSettingsPage() {
  const origin = window.location.origin;

  const { data: biz } = useQuery({ queryKey: ['settings', 'business'], queryFn: () => settingsApi.getBusiness() });
  const { data: tableList } = useQuery({ queryKey: ['tables'], queryFn: () => tablesApi.list() });

  const slug = biz?.orgSlug ?? '';
  const tables = tableList ?? [];

  const menuUrl = `${origin}/order/${slug}`;
  const tableUrl = (id: string) => `${origin}/order/${slug}/table/${id}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between no-print">
        <h1 className="text-lg font-bold text-gray-900">QR Codes</h1>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50">
          <Printer size={14} /> Print all
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {!slug ? (
          <p className="text-sm text-gray-400">Set up your business profile first (Settings → Business).</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* General menu code */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col items-center text-center">
              <img src={qrSrc(menuUrl)} alt="Menu QR" className="w-36 h-36" />
              <p className="text-sm font-semibold text-gray-800 mt-2">General Menu</p>
              <p className="text-[10px] text-gray-400 break-all">{menuUrl}</p>
              <button onClick={() => downloadPng(menuUrl, `qr-menu.png`)} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline no-print"><Download size={12} /> PNG</button>
            </div>

            {tables.map((t) => (
              <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col items-center text-center">
                <img src={qrSrc(tableUrl(t.id))} alt={`${t.name} QR`} className="w-36 h-36" />
                <p className="text-sm font-semibold text-gray-800 mt-2">{t.name}</p>
                {t.section && <p className="text-[11px] text-gray-400">{t.section}</p>}
                <button onClick={() => downloadPng(tableUrl(t.id), `qr-${t.name}.png`)} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline no-print"><Download size={12} /> PNG</button>
              </div>
            ))}

            {tables.length === 0 && (
              <div className="col-span-full text-center py-8">
                <QrCode size={32} className="text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Add tables in Settings → Floor Plan to generate table QR codes.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
