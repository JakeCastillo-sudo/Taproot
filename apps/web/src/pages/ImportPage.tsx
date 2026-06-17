/**
 * ImportPage — AI Document Intelligence Pipeline
 *
 * Drag-and-drop file upload with queue, upload progress, and review/apply flow.
 * Route: /import
 */
import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, FileSpreadsheet, Image, X, ChevronLeft,
  CheckCircle2, AlertCircle, Loader2, Clock, File, Link2, Globe, ChevronDown, AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { importsApi, ApiError, type ImportJob, type ImportStatus } from '../lib/api';
import { QK } from '../lib/queryClient';
import { ImportReview } from '../components/imports/ImportReview';
import { ImportHistory } from '../components/imports/ImportHistory';
import { showToast } from '../components/ui/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadEntry {
  id:       string;
  file:     File;
  status:   'queued' | 'uploading' | 'processing' | 'ready' | 'applying' | 'done' | 'error';
  jobId?:   string;
  error?:   string;
  progress: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const ACCEPTED_EXT = '.pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.txt';
const MAX_SIZE = 10 * 1024 * 1024;

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeIcon(file: File) {
  if (file.type === 'text/csv') return FileSpreadsheet;
  if (file.type.startsWith('image/')) return Image;
  if (file.type === 'application/pdf') return FileText;
  return File;
}

const ENTRY_STATUS_CONFIG: Record<UploadEntry['status'], {
  label: string;
  icon:  React.FC<{ size?: number; className?: string }>;
  cls:   string;
}> = {
  queued:     { label: 'Queued',       icon: Clock,        cls: 'text-gray-400'  },
  uploading:  { label: 'Uploading',    icon: Loader2,      cls: 'text-blue-500'  },
  processing: { label: 'Processing…', icon: Loader2,      cls: 'text-blue-500'  },
  ready:      { label: 'Ready to review', icon: AlertCircle, cls: 'text-amber-500' },
  applying:   { label: 'Applying…',   icon: Loader2,      cls: 'text-blue-500'  },
  done:       { label: 'Complete',    icon: CheckCircle2, cls: 'text-green-600' },
  error:      { label: 'Error',       icon: AlertCircle,  cls: 'text-red-500'   },
};

// ─── URL import helpers ─────────────────────────────────────────────────────────

const URL_ACCEPT_KEY = 'taproot_url_import_accepted';

/** base64 → File (browser) so URL content re-enters the existing upload path. */
function base64ToFile(b64: string, mime: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // window.File — the `File` identifier is shadowed by the lucide-react icon import.
  return new window.File([bytes], name, { type: mime });
}

function extForMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png')  return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif')  return 'gif';
  if (mime.startsWith('image/')) return 'jpg';
  return 'txt';
}

/** Specific, actionable copy per failure code (backend message is the fallback). */
function urlErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'TIMEOUT':
      return '⏱ That page took too long to respond. Try downloading the menu as a PDF and uploading it instead.';
    case 'FETCH_FAILED':
      return "❌ We couldn't reach that URL. Make sure the link works in your browser and is publicly accessible.";
    case 'UNSUPPORTED_TYPE':
      return '🔄 This page can’t be imported directly (it may require JavaScript).\n\nTry instead:\n→ Download the menu as a PDF from the site\n→ Take a screenshot of the menu\n→ Upload either using the Upload File tab';
    case 'TOO_LARGE':
      return '📄 That file is too large to import (max 10MB). Try a different URL or a compressed version.';
    case 'INVALID_URL':
    case 'BLOCKED_HOST':
      return "🔗 That doesn't look like a valid menu URL. Please check the link and try again.";
    default:
      return fallback;
  }
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

function DropZone({ onFiles, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.size <= MAX_SIZE,
      );
      if (files.length) onFiles(files);
    },
    [onFiles, disabled],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onFiles(files);
    e.target.value = '';
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => !disabled && inputRef.current?.click()}
      className={clsx(
        'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-colors p-10 text-center select-none',
        dragging ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/60 hover:bg-gray-50',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXT}
        className="sr-only"
        onChange={handleChange}
      />
      <div className={clsx(
        'w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-colors',
        dragging ? 'bg-primary/10' : 'bg-gray-100',
      )}>
        <Upload size={26} className={dragging ? 'text-primary' : 'text-gray-400'} />
      </div>
      <p className="text-gray-700 font-semibold text-sm">
        {dragging ? 'Release to upload' : 'Upload your menu — PDF, photo, or screenshot'}
      </p>
      <p className="text-gray-400 text-xs mt-1">
        Take a photo of your printed menu, screenshot your existing menu PDF, or upload
        any image. Our AI will read it and import everything.
      </p>
      <p className="text-gray-400 text-xs mt-1">
        Accepted: PDF, PNG, JPG, WebP, CSV, Excel — max 10 MB
      </p>
    </div>
  );
}

// ─── Upload entry row ─────────────────────────────────────────────────────────

interface UploadRowProps {
  entry:    UploadEntry;
  onReview: (entry: UploadEntry) => void;
  onRemove: (id: string) => void;
}

function UploadRow({ entry, onReview, onRemove }: UploadRowProps) {
  const FileIcon = fileTypeIcon(entry.file);
  const sc = ENTRY_STATUS_CONFIG[entry.status];
  const StatusIcon = sc.icon;
  const isSpinning = entry.status === 'uploading' || entry.status === 'processing' || entry.status === 'applying';

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <FileIcon size={16} className="text-gray-500" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{entry.file.name}</p>
        <p className="text-xs text-gray-400">{fmtBytes(entry.file.size)}</p>
        {entry.status === 'uploading' && (
          <div className="mt-1 h-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${entry.progress}%` }}
            />
          </div>
        )}
        {entry.error && (
          <p className="text-xs text-red-500 mt-0.5 truncate">{entry.error}</p>
        )}
      </div>

      <span className={clsx('flex items-center gap-1 text-xs font-medium shrink-0', sc.cls)}>
        <StatusIcon size={13} className={clsx(isSpinning && 'animate-spin')} />
        {sc.label}
      </span>

      {entry.status === 'ready' && (
        <button
          onClick={() => onReview(entry)}
          className="px-3 py-1 rounded text-xs bg-primary text-white hover:bg-primary/90 transition-colors font-medium shrink-0"
        >
          Review
        </button>
      )}

      <button
        onClick={() => onRemove(entry.id)}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ImportPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [entries, setEntries]         = useState<UploadEntry[]>([]);
  const [reviewEntry, setReviewEntry] = useState<UploadEntry | null>(null);
  const [reviewJob, setReviewJob]     = useState<ImportJob | null>(null);
  const [tab, setTab]                 = useState<'upload' | 'history'>('upload');

  // URL import (additive — file upload is unchanged)
  const [inputMode, setInputMode]     = useState<'file' | 'url'>('file');
  const [url, setUrl]                 = useState('');
  const [urlError, setUrlError]       = useState<{ code: string; message: string } | null>(null);
  const [urlLoading, setUrlLoading]   = useState(false);
  const [showLegal, setShowLegal]     = useState(false);
  const [showHelp, setShowHelp]       = useState(false);

  // ── Poll job status ───────────────────────────────────────────────────────

  async function pollUntilReady(jobId: string, entryId: string) {
    const MAX_POLLS = 60;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      try {
        const job = await importsApi.get(jobId);
        if (job.status === 'awaiting_confirmation') {
          setEntries((prev) =>
            prev.map((e) => e.id === entryId ? { ...e, status: 'ready', jobId } : e),
          );
          await qc.invalidateQueries({ queryKey: QK.importJobs() });
          return;
        }
        if (job.status === 'failed') {
          const msg = (job.error_log?.[0]?.message) ?? 'Processing failed';
          setEntries((prev) =>
            prev.map((e) => e.id === entryId ? { ...e, status: 'error', error: msg } : e),
          );
          return;
        }
        if (job.status === 'completed') {
          setEntries((prev) =>
            prev.map((e) => e.id === entryId ? { ...e, status: 'done' } : e),
          );
          return;
        }
      } catch {
        // transient error — keep polling
      }
    }
    setEntries((prev) =>
      prev.map((e) => e.id === entryId ? { ...e, status: 'error', error: 'Timed out waiting for processing' } : e),
    );
  }

  // ── Handle file drop ──────────────────────────────────────────────────────

  const handleFiles = useCallback(
    async (files: File[]) => {
      const newEntries: UploadEntry[] = files.map((f) => ({
        id:       `${Date.now()}-${Math.random()}`,
        file:     f,
        status:   'queued',
        progress: 0,
      }));

      setEntries((prev) => [...newEntries, ...prev]);

      for (const entry of newEntries) {
        // Validate size
        if (entry.file.size > MAX_SIZE) {
          setEntries((prev) =>
            prev.map((e) => e.id === entry.id
              ? { ...e, status: 'error', error: 'File exceeds 10 MB' } : e),
          );
          continue;
        }

        // Set uploading
        setEntries((prev) =>
          prev.map((e) => e.id === entry.id ? { ...e, status: 'uploading', progress: 10 } : e),
        );

        try {
          const { jobId } = await importsApi.upload(entry.file);

          setEntries((prev) =>
            prev.map((e) => e.id === entry.id
              ? { ...e, status: 'processing', jobId, progress: 100 } : e),
          );

          await qc.invalidateQueries({ queryKey: QK.importJobs() });

          // Poll for completion
          pollUntilReady(jobId, entry.id).catch(() => {/* ignore */});

        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          setEntries((prev) =>
            prev.map((e) => e.id === entry.id ? { ...e, status: 'error', error: message } : e),
          );
          showToast.error(message);
        }
      }
    },
    [qc],
  );

  // ── URL import ────────────────────────────────────────────────────────────
  // Fetch the URL, convert the returned content to a File, then hand off to the
  // EXISTING upload pipeline (handleFiles) — same job, parse, review, confirm.

  const runUrlImport = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) { setUrlError({ code: 'MISSING_URL', message: 'Please enter a menu URL.' }); return; }
    setUrlError(null);
    setUrlLoading(true);
    try {
      const fetched = await importsApi.fetchMenuUrl(trimmed);
      let file: File;
      if (fetched.contentType === 'html') {
        const body = `Restaurant menu webpage content${fetched.pageTitle ? ` — ${fetched.pageTitle}` : ''}:\n\n${fetched.content}`;
        file = new window.File([body], 'menu-from-url.txt', { type: 'text/plain' });
      } else {
        file = base64ToFile(fetched.content, fetched.mimeType, `menu-from-url.${extForMime(fetched.mimeType)}`);
      }
      await handleFiles([file]); // existing pipeline takes over (queue → review)
      setUrl('');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'FETCH_FAILED';
      const msg  = err instanceof ApiError ? err.message : 'Something went wrong fetching that URL.';
      setUrlError({ code, message: urlErrorMessage(code, msg) });
    } finally {
      setUrlLoading(false);
    }
  }, [url, handleFiles]);

  const handleUrlImportClick = useCallback(() => {
    if (!url.trim()) { setUrlError({ code: 'MISSING_URL', message: 'Please enter a menu URL.' }); return; }
    let accepted = false;
    try { accepted = sessionStorage.getItem(URL_ACCEPT_KEY) === 'true'; } catch { /* ignore */ }
    if (accepted) void runUrlImport();
    else setShowLegal(true);
  }, [url, runUrlImport]);

  const confirmLegal = useCallback(() => {
    try { sessionStorage.setItem(URL_ACCEPT_KEY, 'true'); } catch { /* ignore */ }
    setShowLegal(false);
    void runUrlImport();
  }, [runUrlImport]);

  // ── Review ────────────────────────────────────────────────────────────────

  const handleReview = useCallback(async (entry: UploadEntry) => {
    if (!entry.jobId) return;
    try {
      const job = await importsApi.get(entry.jobId);
      setReviewJob(job);
      setReviewEntry(entry);
    } catch (err: unknown) {
      showToast.error(err instanceof Error ? err.message : 'Failed to load job');
    }
  }, []);

  const handleHistoryReview = useCallback(async (job: ImportJob) => {
    setReviewJob(job);
    setReviewEntry(null);
  }, []);

  const handleReviewDone = useCallback(() => {
    if (reviewEntry) {
      setEntries((prev) =>
        prev.map((e) => e.id === reviewEntry.id ? { ...e, status: 'done' } : e),
      );
    }
    setReviewJob(null);
    setReviewEntry(null);
    void qc.invalidateQueries({ queryKey: QK.importJobs() });
    setTab('history');
  }, [reviewEntry, qc]);

  // ── Render review panel ───────────────────────────────────────────────────

  if (reviewJob) {
    // BUG-IMP-003 fix: constrain outer to h-screen so ImportReview's
    // h-full resolves to the viewport height and internal flex-1 scroll works.
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <div className="flex-1 max-w-3xl mx-auto w-full p-4 flex flex-col min-h-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col flex-1 min-h-0">
            <ImportReview
              job={reviewJob}
              onDone={handleReviewDone}
              onCancel={() => { setReviewJob(null); setReviewEntry(null); }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Main page ─────────────────────────────────────────────────────────────

  const activeCount = entries.filter(
    (e) => e.status === 'uploading' || e.status === 'processing',
  ).length;

  return (
    <div className="h-screen overflow-y-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft size={18} className="text-gray-600" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">Document Import</h1>
        {activeCount > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-blue-600 font-medium">
            <Loader2 size={12} className="animate-spin" />
            Processing {activeCount} file{activeCount > 1 ? 's' : ''}…
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {(['upload', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors',
                tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {tab === 'upload' && (
          <>
            {/* Input mode: file upload (existing) vs URL */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
              <button
                onClick={() => setInputMode('file')}
                className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                  inputMode === 'file' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}
              >
                <Upload size={14} /> Upload File
              </button>
              <button
                onClick={() => setInputMode('url')}
                className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                  inputMode === 'url' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}
              >
                <Link2 size={14} /> Paste a URL
              </button>
            </div>

            {inputMode === 'file' ? (
              <DropZone onFiles={handleFiles} />
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="menu-url" className="block text-sm font-semibold text-gray-700 mb-1.5">Menu URL</label>
                  <input
                    id="menu-url"
                    type="url"
                    autoComplete="off"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); if (urlError) setUrlError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUrlImportClick(); }}
                    placeholder="https://yourrestaurant.com/menu"
                    disabled={urlLoading}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-gray-50"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Works best with PDF menu links and simple website menus. Some sites may not be importable.
                  </p>
                </div>

                {urlError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700 whitespace-pre-line">
                    {urlError.message}
                  </div>
                )}

                <button
                  onClick={handleUrlImportClick}
                  disabled={urlLoading || !url.trim()}
                  className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  {urlLoading
                    ? (<><Loader2 size={15} className="animate-spin" /> Fetching menu from URL…</>)
                    : (<>Import from URL →</>)}
                </button>

                {/* Collapsible "what works?" guide */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowHelp((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5"><Globe size={14} /> What URLs work best?</span>
                    <ChevronDown size={15} className={clsx('transition-transform', showHelp && 'rotate-180')} />
                  </button>
                  {showHelp && (
                    <div className="px-4 pb-3 pt-2 border-t border-gray-100 text-xs text-gray-500 space-y-3">
                      <div>
                        <p className="font-semibold text-green-700">✅ Works well</p>
                        <ul className="mt-1 space-y-0.5 list-disc list-inside">
                          <li>Direct PDF links (restaurant.com/menu.pdf)</li>
                          <li>Simple restaurant website menus</li>
                          <li>Most menu pages with visible text</li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-amber-600">⚠️ May not work</p>
                        <ul className="mt-1 space-y-0.5 list-disc list-inside">
                          <li>Sites that require JavaScript to load (common with modern restaurant sites)</li>
                          <li>Menus behind a login wall or paywall</li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold text-red-600">❌ Won’t work</p>
                        <ul className="mt-1 space-y-0.5 list-disc list-inside">
                          <li>Google Maps menu pages</li>
                          <li>DoorDash or Uber Eats menus</li>
                          <li>Toast or Square customer menus</li>
                        </ul>
                      </div>
                      <p className="text-gray-400">
                        💡 Tip: if a URL doesn’t work, right-click the menu PDF link on the restaurant’s website and copy the direct PDF URL.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {entries.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Upload queue
                  </p>
                  <button
                    onClick={() => setEntries([])}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <UploadRow
                      key={entry.id}
                      entry={entry}
                      onReview={handleReview}
                      onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <ImportHistory onReview={handleHistoryReview} />
        )}
      </div>

      {/* ── Legal disclaimer modal (URL import — once per session) ──────────── */}
      {showLegal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-amber-500" />
              <h2 className="text-base font-bold text-gray-900">Before you import</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">By importing this menu, you confirm that:</p>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li className="flex gap-2"><span className="text-green-600 shrink-0">✓</span> You own or have permission to use this menu content.</li>
              <li className="flex gap-2"><span className="text-green-600 shrink-0">✓</span> Menu items, names, and descriptions may be protected by intellectual property law.</li>
              <li className="flex gap-2"><span className="text-green-600 shrink-0">✓</span> You are responsible for ensuring you have the right to use this content in your Taproot POS.</li>
            </ul>
            <p className="text-xs text-gray-400 mb-5">
              Taproot does not verify ownership of imported content and is not responsible for any
              intellectual property claims arising from menu imports.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLegal(false)}
                className="flex-1 h-10 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmLegal}
                className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors"
              >
                I Understand, Continue Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
