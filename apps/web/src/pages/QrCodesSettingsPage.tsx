/**
 * QrCodesSettingsPage — /settings/qr-codes
 *
 * One QR code per table (plus a general menu code) pointing at the public
 * storefront /order/:slug[/table/:id]. QR images are rendered via a public QR
 * image service (no extra dependency). Download PNG per code; Print all.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, QrCode, Copy, ExternalLink } from 'lucide-react';
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

/** Download a branded 600×720 PNG: QR + "Order from {name}" + taproot-pos.com. */
async function downloadBrandedPng(url: string, restaurantName: string) {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = qrSrc(url, 512);
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load')); });
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 600, 720);
    ctx.drawImage(img, 44, 40, 512, 512);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 34px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Order from ${restaurantName}`, 300, 605, 560);
    ctx.fillStyle = '#1D9E75';
    ctx.font = '600 26px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('taproot-pos.com', 300, 650);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
    if (!blob) throw new Error('toBlob');
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj; a.download = `taproot-qr-${restaurantName.replace(/\s+/g, '-').toLowerCase()}.png`; a.click();
    URL.revokeObjectURL(obj);
  } catch {
    // Canvas may be tainted by CORS — fall back to the plain QR PNG.
    await downloadPng(url, 'taproot-qr-menu.png');
  }
}

export function QrCodesSettingsPage() {
  const origin = window.location.origin;
  const [copied, setCopied] = useState(false);

  const { data: biz } = useQuery({ queryKey: ['settings', 'business'], queryFn: () => settingsApi.getBusiness() });
  const { data: tableList } = useQuery({ queryKey: ['tables'], queryFn: () => tablesApi.list() });

  const slug = biz?.orgSlug ?? '';
  const orgName = biz?.orgName || 'Restaurant';
  const tables = tableList ?? [];

  const menuUrl = `${origin}/order/${slug}`;
  const tableUrl = (id: string) => `${origin}/order/${slug}/table/${id}`;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(menuUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); showToast.success('Link copied'); }
    catch { showToast.error('Could not copy link'); }
  };

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
          <>
          {/* Online ordering link */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 no-print max-w-xl">
            <p className="text-sm font-bold text-gray-900 mb-2">Your online ordering link</p>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-md px-3 py-2 mb-3">
              <span className="flex-1 text-sm text-gray-600 break-all">{menuUrl}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void copyLink()} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">
                <Copy size={14} /> {copied ? 'Copied!' : 'Copy link'}
              </button>
              <button onClick={() => void downloadBrandedPng(menuUrl, orgName)} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50">
                <Download size={14} /> Download QR code
              </button>
              <a href={menuUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50">
                <ExternalLink size={14} /> Preview menu
              </a>
            </div>
          </div>

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
          </>
        )}
      </div>
    </div>
  );
}
