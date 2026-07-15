'use client';

import { useParams } from 'next/navigation';

export default function FolderPage() {
  const { id } = useParams();

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Archive Folder</h1>
        <p className="text-zinc-400 mb-10">ID: {id}</p>
        
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-12 text-center">
          <p className="text-xl text-zinc-400">Gallery coming soon...</p>
          <p className="text-sm mt-4 text-zinc-500">Stories will appear here as they are archived</p>
        </div>
      </div>
    </div>
  );
}
