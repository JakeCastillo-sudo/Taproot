/**
 * NLQueryBar — natural language analytics query input.
 */

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X } from 'lucide-react';
import { clsx } from 'clsx';
import { ai, type NLQueryResponse } from '../../lib/api';
import { SalesBarChart } from '../charts/SalesBarChart';

const EXAMPLES = [
  'What were my top 5 items last week?',
  'Which day had the highest revenue this month?',
  'How much did I make on burgers vs pizza?',
  'What is my average order value on weekends?',
  'Which staff member has the highest sales?',
];

interface HistoryItem {
  query:    string;
  response: NLQueryResponse;
}

export function NLQueryBar() {
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState<NLQueryResponse | null>(null);
  const [history,     setHistory]     = useState<HistoryItem[]>([]);
  const [placeholder, setPlaceholder] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rotate placeholder examples
  useEffect(() => {
    const t = setInterval(() => setPlaceholder((p) => (p + 1) % EXAMPLES.length), 4000);
    return () => clearInterval(t);
  }, []);

  async function handleSubmit() {
    const q = input.trim();
    if (!q || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await ai.nlQuery(q);
      setResult(res);
      setHistory((h) => [{ query: q, response: res }, ...h].slice(0, 5));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gradient-to-r from-primary/5 to-primary/[0.03] border border-primary/20 rounded-xl p-4 mb-6">
      {/* Input row */}
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary shrink-0" />
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            placeholder={EXAMPLES[placeholder]}
            disabled={loading}
            className="w-full py-2 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-gray-400 disabled:opacity-60"
          />
        </div>
        <button
          onClick={() => void handleSubmit()}
          disabled={!input.trim() || loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-white animate-bounce"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          ) : (
            <Send size={13} />
          )}
          <span className="hidden sm:inline">{loading ? 'Thinking…' : 'Ask'}</span>
        </button>
      </div>

      {/* History chips */}
      {history.length > 0 && !result && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {history.map((h, i) => (
            <button
              key={i}
              onClick={() => { setInput(h.query); setResult(h.response); }}
              className="px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:border-primary/40 hover:text-primary transition-colors"
            >
              {h.query.length > 40 ? `${h.query.slice(0, 40)}…` : h.query}
            </button>
          ))}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-3 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm text-gray-800 leading-relaxed">{result.answer}</p>
            <button
              onClick={() => setResult(null)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 shrink-0"
            >
              <X size={13} />
            </button>
          </div>

          {/* Data table */}
          {result.data && result.data.length > 0 && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    {Object.keys(result.data[0]).map((k) => (
                      <th key={k} className="text-left px-2 py-1.5 font-medium text-gray-500 capitalize">
                        {k.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-2 py-1.5 text-gray-700">
                          {String(v ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mini chart */}
          {result.chartType === 'bar' && result.data && result.data.length > 0 && (
            <div className="mt-3">
              <SalesBarChart
                data={result.data as Array<Record<string, unknown>>}
                xKey={Object.keys(result.data[0])[0]}
                bars={[{ key: Object.keys(result.data[0])[1] ?? 'value', color: '#16a34a', label: 'Value' }]}
                height={140}
                showLegend={false}
                yFormatter={(v) => String(v)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
