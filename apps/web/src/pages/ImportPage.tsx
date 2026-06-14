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
  CheckCircle2, AlertCircle, Loader2, Clock, File,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { importsApi, type ImportJob, type ImportStatus } from '../lib/api';
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
            <DropZone onFiles={handleFiles} />

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
    </div>
  );
}
