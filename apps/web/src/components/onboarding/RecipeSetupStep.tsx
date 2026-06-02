/**
 * RecipeSetupStep — Step 4 (optional)
 *
 * Explains the value of recipes, then lets the user upload a recipe
 * sheet (CSV, PDF, or plain text) or skip.
 *
 * After upload, polls the import job and shows detected recipes.
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, Type, Loader2, Check, ChevronRight, X } from 'lucide-react';
import { clsx } from 'clsx';
import { importsApi } from '../../lib/api';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RecipeSetupStepProps {
  onComplete: (recipeCount: number) => void;
  onSkip:     () => void;
}

// ─── Benefit card data ────────────────────────────────────────────────────────

const BENEFITS = [
  {
    emoji: '💰',
    title: 'Know your true costs',
    desc:  'See exactly what each dish costs to make — in real time.',
    color: 'bg-green-50 border-green-100',
  },
  {
    emoji: '♻️',
    title: 'Reduce waste',
    desc:  'AI flags when your usage diverges from expected recipe yields.',
    color: 'bg-blue-50 border-blue-100',
  },
  {
    emoji: '📈',
    title: 'Protect your margins',
    desc:  'Instant alerts when supplier prices erode your profit per plate.',
    color: 'bg-purple-50 border-purple-100',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function RecipeSetupStep({ onComplete, onSkip }: RecipeSetupStepProps) {
  const [view,         setView]         = useState<'benefits' | 'upload' | 'processing' | 'done' | 'error'>('benefits');
  const [recipeCount,  setRecipeCount]  = useState(0);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [textValue,    setTextValue]    = useState('');
  const [showText,     setShowText]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const pollJob = useCallback((jobId: string) => {
    const startTs = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startTs > 3 * 60 * 1000) {
        stopPoll();
        setErrorMsg('Import timed out. You can set up recipes later from Settings.');
        setView('error');
        return;
      }
      try {
        const job = await importsApi.get(jobId);
        if (job.status === 'awaiting_confirmation' || job.status === 'completed') {
          stopPoll();
          const parsed = (job.mapping_config as { recipes?: unknown[] } | null)?.recipes ?? [];
          setRecipeCount(parsed.length);
          setView('done');
        } else if (job.status === 'failed') {
          stopPoll();
          setErrorMsg('Couldn\'t parse this file. Try a CSV or paste text below.');
          setView('error');
        }
      } catch {
        // Keep polling on transient errors
      }
    }, 2000);
  }, []);

  const handleFile = async (file: File) => {
    setView('processing');
    setErrorMsg(null);
    try {
      const { jobId } = await importsApi.upload(file);
      pollJob(jobId);
    } catch {
      setErrorMsg('Upload failed. Check your connection.');
      setView('error');
    }
  };

  const handleText = async () => {
    if (!textValue.trim()) return;
    setView('processing');
    setErrorMsg(null);
    try {
      const blob = new Blob([textValue], { type: 'text/plain' });
      const file = new File([blob], 'recipes.txt', { type: 'text/plain' });
      const { jobId } = await importsApi.upload(file);
      pollJob(jobId);
    } catch {
      setErrorMsg('Upload failed. You can set up recipes later.');
      setView('error');
    }
  };

  // ── Benefits view ───────────────────────────────────────────────────────────
  if (view === 'benefits') {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Set up your recipes</h2>
        <p className="text-sm text-gray-500 mb-4">
          Optional but powerful — takes about 3 minutes
        </p>

        <div className="space-y-3 mb-6">
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className={clsx(
                'flex items-start gap-3 p-3.5 rounded-xl border',
                b.color,
              )}
            >
              <span className="text-2xl shrink-0 mt-0.5">{b.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">{b.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setView('upload')}
          className="w-full py-3 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2"
        >
          Set up recipes
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip for now — I&apos;ll do this later
        </button>
      </div>
    );
  }

  // ── Upload view ─────────────────────────────────────────────────────────────
  if (view === 'upload') {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Upload your recipes</h2>
        <p className="text-sm text-gray-500 mb-5">
          A spreadsheet, PDF, or even plain text works fine
        </p>

        <div className="space-y-3 mb-4">
          {/* File upload */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-primary/40 hover:bg-primary/5 text-left transition-all active:scale-[0.99]"
          >
            <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-orange-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Upload a file</p>
              <p className="text-xs text-gray-400 mt-0.5">CSV, Excel, or PDF</p>
            </div>
            <Upload size={14} className="text-gray-300 ml-auto mt-1 shrink-0" />
          </button>

          {/* Text paste */}
          <div
            className={clsx(
              'rounded-xl border-2 transition-all',
              showText
                ? 'border-primary/40 bg-primary/5 p-4'
                : 'border-dashed border-gray-200 hover:border-primary/40 hover:bg-primary/5 cursor-pointer p-4',
            )}
            onClick={() => !showText && setShowText(true)}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <Type size={18} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">Paste or type recipes</p>
                <p className="text-xs text-gray-400 mt-0.5">Any format — we&apos;ll figure it out</p>
              </div>
            </div>
            {showText && (
              <div className="mt-3">
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={`Espresso: 18g coffee, 36g water\nLatte: 18g coffee, 150ml milk\nCaesar Salad: romaine, parmesan, croutons…`}
                  rows={5}
                  className="w-full text-xs px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white resize-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleText(); }}
                  disabled={!textValue.trim()}
                  className="mt-2 w-full py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors"
                >
                  Process recipes →
                </button>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.pdf,.txt"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip — I&apos;ll add recipes later
        </button>
      </div>
    );
  }

  // ── Processing ──────────────────────────────────────────────────────────────
  if (view === 'processing') {
    return (
      <div className="text-center py-10">
        <Loader2 size={40} className="animate-spin text-primary mx-auto mb-5" />
        <p className="text-base font-medium text-gray-700">Analysing your recipes…</p>
        <p className="text-sm text-gray-400 mt-1">Matching ingredients to your inventory</p>
        <div className="w-48 h-1.5 bg-gray-100 rounded-full mx-auto mt-5 overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  if (view === 'done') {
    return (
      <div>
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">
            {recipeCount > 0
              ? `${recipeCount} recipe${recipeCount !== 1 ? 's' : ''} detected!`
              : 'Recipes uploaded!'}
          </h2>
          <p className="text-sm text-gray-500">
            {recipeCount > 0
              ? 'We\'ll link them to your menu items automatically.'
              : 'We\'ll process them and link to your products.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onComplete(recipeCount)}
          className="w-full py-3 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          Apply &amp; Continue →
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip for now
        </button>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mb-5">
        <X size={15} className="text-red-500 shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{errorMsg}</p>
      </div>

      <button
        type="button"
        onClick={() => { setView('upload'); setErrorMsg(null); }}
        className="w-full py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors mb-3"
      >
        ← Try again
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}
