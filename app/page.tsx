'use client';

import { useState, useEffect } from 'react';
import { Plus, Clock, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

interface WatchedLink {
  id: string;
  source_url: string;
  platform: 'facebook' | 'instagram';
  label?: string;
  story_count: number;
  last_checked_at?: string;
  created_at?: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [links, setLinks] = useState<WatchedLink[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load links (you can improve this with Supabase fetch later)
  useEffect(() => {
    // TODO: Fetch from Supabase
    setLinks([]);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed');

      setMessage({ 
        type: 'success', 
        text: `Archived at ${format(new Date(), 'hh:mm a')}` 
      });
      setUrl('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-semibold">Story Archiver</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 mb-8">
            <label className="block text-sm uppercase tracking-widest text-zinc-500 mb-3">PUBLIC STORY LINK</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste Facebook story link..."
              className="w-full bg-black border border-zinc-700 rounded-2xl px-6 py-5 text-lg"
            />
            <button
              type="submit"
              disabled={isSubmitting || !url}
              className="w-full mt-4 py-4 bg-white text-black font-semibold rounded-2xl flex items-center justify-center gap-3"
            >
              {isSubmitting ? 'ARCHIVING...' : 'START ARCHIVING THIS STORY'}
              <Plus className="w-5 h-5" />
            </button>
          </form>

          {message && (
            <div className={`p-4 rounded-2xl mb-8 ${message.type === 'success' ? 'bg-emerald-900' : 'bg-red-900'}`}>
              {message.text}
            </div>
          )}

          <h2 className="text-xl font-semibold mb-6">Active Archives ({links.length})</h2>

          {links.length === 0 ? (
            <div className="bg-zinc-900 border border-dashed border-zinc-800 rounded-3xl py-24 text-center">
              <p className="text-zinc-400">No archives yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {links.map(link => (
                <div key={link.id} className="bg-zinc-900 p-6 rounded-3xl flex justify-between items-center">
                  <div>
                    <p className="font-medium truncate">{link.source_url}</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {link.created_at ? format(new Date(link.created_at), 'dd MMM yyyy, hh:mm a') : 'Just now'}
                    </p>
                  </div>
                  <ExternalLink className="w-5 h-5 text-zinc-400" />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
} 
