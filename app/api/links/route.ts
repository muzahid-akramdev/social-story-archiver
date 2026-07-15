import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { extractStoryMedia } from '@/lib/extract';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function detectPlatform(url: string): Promise<'facebook' | 'instagram'> {
  const lower = url.toLowerCase();
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('stories')) return 'facebook';
  if (lower.includes('instagram.com')) return 'instagram';
  throw new Error('Unsupported platform.');
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const platform = await detectPlatform(url);

    // Extract media
    const mediaItems = await extractStoryMedia(url, platform);

    // Save to DB
    const { data: existing } = await supabase
      .from('watched_links')
      .select('id')
      .eq('source_url', url)
      .single();

    let linkId;
    if (existing) {
      linkId = existing.id;
    } else {
      const { data, error } = await supabase
        .from('watched_links')
        .insert({
          source_url: url,
          platform,
          label: url.split('/').pop() || 'Untitled',
        })
        .select()
        .single();

      if (error) throw error;
      linkId = data.id;
    }

    return NextResponse.json({
      id: linkId,
      source_url: url,
      platform,
      mediaCount: mediaItems.length,
      message: `Started archiving with ${mediaItems.length} media item(s)`,
    });

  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 });
  }
}
