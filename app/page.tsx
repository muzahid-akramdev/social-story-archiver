'use client';

import { useState } from 'react';
import { Plus, Clock, ExternalLink, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

interface WatchedLink {
  id: string;
  source_url: string;
  platform: 'facebook' | 'instagram';
  label?: string;
  story_count: number;
  last_checked_at?: string;
  last_new_story_at?: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [links, setLinks] = useState<WatchedLink[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

      if (!res.ok) {
        throw new Error(data.error || 'Failed to archive link');
      }

      setMessage({ type: 'success', text: `Started archiving: ${data.label || data.source_url}` });
      setUrl('');
      // TODO: Refresh links list
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPlatformIcon = (platform: string) => {
    return platform === 'facebook' ? '📘' : '📷';
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-2xl">📼</div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tighter">Story Archiver</h1>
              <p className="text-sm text-zinc-400 -mt-1">Automatic public story backups</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="max-w-2xl mx-auto">
          {/* Submit Form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 mb-16">
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <label className="block text-sm uppercase tracking-widest text-zinc-500 mb-3">PUBLIC STORY LINK</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://facebook.com/story.php?story_fbid=... or Instagram story link"
                  className="w-full bg-black border border-zinc-700 focus:border-purple-500 rounded-2xl px-6 py-5 text-lg placeholder-zinc-500 focus:outline-none"
                  disabled={isSubmitting}
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !url}
                  className="w-full py-4 bg-white hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-70 text-black font-semibold rounded-2xl flex items-center justify-center gap-3 transition-all"
                >
                  {isSubmitting ? 'ARCHIVING...' : 'START ARCHIVING THIS STORY'}
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </form>
            <p className="text-center text-xs text-zinc-500 mt-6">
              Stories are checked automatically every ~10 minutes
            </p>
          </div>
        </div>

        {message && (
          <div className={`max-w-2xl mx-auto mb-8 p-4 rounded-2xl text-center ${message.type === 'success' ? 'bg-emerald-950 border border-emerald-900' : 'bg-red-950 border border-red-900'}`}>
            {message.text}
          </div>
        )}

        {/* Archives List */}
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 px-1">
            Active Archives 
            <span className="text-sm font-normal text-zinc-500">({links.length || 0})</span>
          </h2>

          {links.length === 0 ? (
            <div className="bg-zinc-900 border border-dashed border-zinc-800 rounded-3xl py-24 text-center">
              <div className="text-6xl mb-6 opacity-40">📼</div>
              <p className="text-zinc-400">Your archives will appear here</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Cards populated dynamically */}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
