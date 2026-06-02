/**
 * MenuUploadStep — Step 2
 *
 * Four options: PDF/photo, CSV/Excel, URL, manual.
 * Processes via existing import API and polls for completion.
 * "Try with demo menu" link for users without a menu handy.
 */

import { useState, useRef, useCallback } from 'react';
import { FileText, Table, Link2, Pencil, Upload, X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { importsApi } from '../../lib/api';
import { analytics } from '../../lib/analytics';
import { ManualEntryStep } from './ManualEntryStep';
import { DemoMenuButton, DEMO_MENU_ITEMS } from './DemoMenuButton';
import type { MenuReviewItem } from '../../store/onboarding.store';

// ─── Processing messages ──────────────────────────────────────────────────────

const MESSAGES = [
  'Reading your menu... 📖',
  'Counting your dishes 🍽️',
  'Finding the categories ✨',
  'Checking the prices 💰',
  'Spotting the specials 🌟',
  'Almost there... 🪄',
];

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadStatus = 'idle' | 'uploading' | 'parsing' | 'done' | 'error';

interface MenuUploadStepProps {
  locationId:   string;
  onComplete:   (items: MenuReviewItem[], jobId: string) => void;
  onSkip:       () => void;
}

function buildTemplateUrl(): string {
  const rows = [
    'name,price,category,description',
    'Espresso,4.50,Beverages,Double shot',
    'Latte,5.50,Beverages,With steamed milk',
    'Avocado Toast,12.00,Mains,Sourdough bread',
  ].join('\n');
  const blob = new Blob([rows], { type: 'text/csv' });
  return URL.createObjectURL(blob);
}

export function MenuUploadStep({ locationId, onComplete, onSkip }: MenuUploadStepProps) {
  const [status,       setStatus]       = useState<UploadStatus>('idle');
  const [msgIdx,       setMsgIdx]       = useState(0);
  const [error,        setError]        = useState<string | null>(null);
  const [urlValue,     setUrlValue]     = useState('');
  const [showManual,   setShowManual]   = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotate processing messages
  const startMessageCycle = () => {
    msgRef.current = setInterval(() => {
      setMsgIdx((i) => (i + 1) % MESSAGES.length);
    }, 2000);
  };

  const stopCycles = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (msgRef.current)  clearInterval(msgRef.current);
  };

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setStatus('uploading');
    analytics.menuUploadStarted(
      file.type === 'text/csv' || file.name.endsWith('.csv') ? 'csv' : 'pdf',
    );

    try {
      const { jobId } = await importsApi.upload(file);
      setStatus('parsing');
      startMessageCycle();

      // Poll every 2s until done
      const startTs = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - startTs > 3 * 60 * 1000) {
          stopCycles();
          setStatus('error');
          setError('Import timed out. Please try a different file.');
          return;
        }
        const job = await importsApi.get(jobId);
        if (job.status === 'awaiting_confirmation' || job.status === 'completed') {
          stopCycles();
          setStatus('done');
          // Convert parsed data to review items
          const parsed = (job.mapping_config as { items?: unknown[] } | null)?.items ?? [];
          const items: MenuReviewItem[] = (parsed as Array<{
            name?: string; price?: number; category?: string; description?: string; confidence?: number;
          }>).map((p, i) => ({
            id:          `job-${jobId}-${i}`,
            name:        p.name ?? '',
            price:       Math.round((p.price ?? 0) * 100),
            category:    p.category ?? 'Uncategorized',
            description: p.description ?? '',
            confidence:  p.confidence ?? 0.8,
          }));
          analytics.menuUploadCompleted(
            items.length,
            items.reduce((s, it) => s + it.confidence, 0) / Math.max(items.length, 1),
          );
          onComplete(items, jobId);
        } else if (job.status === 'failed') {
          stopCycles();
          setStatus('error');
          setError('We couldn\'t read this file. Try a different format or use manual entry.');
        }
      }, 2000);
    } catch {
      stopCycles();
      setStatus('error');
      setError('Upload failed. Check your connection and try again.');
    }
  }, [locationId, onComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const handleUrl = async () => {
    if (!urlValue.trim()) return;
    setError(null);
    setStatus('uploading');
    analytics.menuUploadStarted('url');
    try {
      const { jobId } = await (
        await import('../../lib/api')
      ).onboardingApi.menuFromUrl(urlValue.trim());
      setStatus('parsing');
      startMessageCycle();
      const startTs = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - startTs > 3 * 60 * 1000) {
          stopCycles();
          setStatus('error');
          setError('Import timed out. Please try a different URL or use manual entry.');
          return;
        }
        const job = await importsApi.get(jobId);
        if (job.status === 'awaiting_confirmation' || job.status === 'completed') {
          stopCycles();
          setStatus('done');
          const parsed = (job.mapping_config as { items?: unknown[] } | null)?.items ?? [];
          const items: MenuReviewItem[] = (parsed as Array<{
            name?: string; price?: number; category?: string; description?: string; confidence?: number;
          }>).map((p, i) => ({
            id:          `job-${jobId}-${i}`,
            name:        p.name ?? '',
            price:       Math.round((p.price ?? 0) * 100),
            category:    p.category ?? 'Uncategorized',
            description: p.description ?? '',
            confidence:  p.confidence ?? 0.8,
          }));
          onComplete(items, jobId);
        } else if (job.status === 'failed') {
          stopCycles();
          setStatus('error');
          setError('Couldn\'t read the URL. Try uploading the menu PDF instead.');
        }
      }, 2000);
    } catch (err) {
      stopCycles();
      setStatus('error');
      setError(err instanceof Error ? err.message : 'URL fetch failed');
    }
  };

  const cancel = () => {
    stopCycles();
    setStatus('idle');
    setError(null);
  };

  // ── Manual entry mode ──────────────────────────────────────────────────────
  if (showManual) {
    return (
      <ManualEntryStep
        onConfirm={(items) => {
          analytics.menuUploadStarted('manual');
          analytics.menuUploadCompleted(items.length, 1);
          onComplete(items, 'manual');
        }}
        onBack={() => setShowManual(false)}
      />
    );
  }

  // ── Processing state ───────────────────────────────────────────────────────
  if (status === 'uploading' || status === 'parsing') {
    return (
      <div className="text-center py-8">
        <Loader2 size={40} className="animate-spin text-primary mx-auto mb-5" />
        <p className="text-base font-medium text-gray-700 mb-1">
          {status === 'uploading' ? 'Uploading...' : MESSAGES[msgIdx]}
        </p>
        <p className="text-sm text-gray-400 mb-6">Hold tight — we&apos;re doing the hard work for you</p>
        <div className="w-64 h-1.5 bg-gray-100 rounded-full mx-auto overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
        <button
          onClick={cancel}
          className="mt-6 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Upload your menu</h2>
      <p className="text-sm text-gray-500 mb-5">
        We&apos;ll read it and create all your items automatically
      </p>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mb-4">
          <X size={15} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Upload cards */}
      <div className="grid sm:grid-cols-2 gap-3 mb-3">

        {/* Card 1: PDF / Photo */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={clsx(
            'p-4 rounded-xl border-2 border-dashed text-left transition-all',
            'border-gray-200 hover:border-primary/50 hover:bg-primary/5',
            'active:scale-[0.98] group',
          )}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
              <FileText size={16} className="text-orange-600" />
            </div>
            <span className="font-semibold text-gray-800 text-sm">PDF or photo</span>
          </div>
          <p className="text-xs text-gray-500">
            Works with any menu — even a photo of a chalkboard
          </p>
          <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG, HEIC</p>
        </button>

        {/* Card 2: Spreadsheet */}
        <button
          type="button"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = '.csv,.xlsx,.xls';
              fileInputRef.current.click();
            }
          }}
          className={clsx(
            'p-4 rounded-xl border-2 border-dashed text-left transition-all',
            'border-gray-200 hover:border-primary/50 hover:bg-primary/5',
            'active:scale-[0.98]',
          )}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <Table size={16} className="text-green-600" />
            </div>
            <span className="font-semibold text-gray-800 text-sm">Excel or CSV</span>
          </div>
          <p className="text-xs text-gray-500">Name, price, category columns</p>
          <a
            href={buildTemplateUrl()}
            download="taproot-menu-template.csv"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline mt-1 block"
          >
            Download template
          </a>
        </button>

        {/* Card 3: URL */}
        <div
          className={clsx(
            'p-4 rounded-xl border-2 text-left transition-all',
            showUrlInput
              ? 'border-primary/50 bg-primary/5'
              : 'border-dashed border-gray-200 hover:border-primary/50 hover:bg-primary/5 cursor-pointer',
          )}
          onClick={() => !showUrlInput && setShowUrlInput(true)}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Link2 size={16} className="text-blue-600" />
            </div>
            <span className="font-semibold text-gray-800 text-sm">Website URL</span>
          </div>
          <p className="text-xs text-gray-500 mb-2">Paste a link to your online menu</p>
          {showUrlInput && (
            <div className="flex gap-2">
              <input
                type="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://yourrestaurant.com/menu"
                className="flex-1 text-xs px-2.5 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleUrl(); }}
                disabled={!urlValue.trim()}
                className="px-2.5 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                Fetch
              </button>
            </div>
          )}
        </div>

        {/* Card 4: Manual */}
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className={clsx(
            'p-4 rounded-xl border-2 border-dashed text-left transition-all',
            'border-gray-200 hover:border-primary/50 hover:bg-primary/5',
            'active:scale-[0.98]',
          )}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <Pencil size={16} className="text-purple-600" />
            </div>
            <span className="font-semibold text-gray-800 text-sm">Type it in</span>
          </div>
          <p className="text-xs text-gray-500">Always works, takes a bit longer</p>
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.csv,.xlsx,.xls"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {/* Upload zone hint */}
      <p className="text-center text-xs text-gray-400 mb-1">
        <Upload size={11} className="inline mr-1" />
        Drag and drop any file onto a card
      </p>

      {/* Demo menu link */}
      <DemoMenuButton
        onLoad={(items) => {
          analytics.menuUploadStarted('demo');
          analytics.menuUploadCompleted(items.length, 1);
          onComplete(items, 'demo');
        }}
      />

      {/* Skip */}
      <div className="text-center mt-5">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip for now — I&apos;ll add products manually
        </button>
      </div>
    </div>
  );
}
