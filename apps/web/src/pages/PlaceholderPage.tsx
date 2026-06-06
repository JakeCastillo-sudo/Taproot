import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface Props { title: string; icon: ReactNode }

export function PlaceholderPage({ title, icon }: Props) {
  const navigate = useNavigate();
  return (
    <div className="h-screen overflow-y-auto bg-surface-2 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-300 mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-gray-700 mb-1">{title}</h1>
      <p className="text-sm text-gray-400 mb-6">This page will be built in a future prompt.</p>
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-sm text-primary hover:text-primary-dark transition-colors"
      >
        <ArrowLeft size={14} /> Back to POS
      </button>
    </div>
  );
}
