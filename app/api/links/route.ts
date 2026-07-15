import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { extractStoryMedia, downloadMedia } from '@/lib/extract';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const BUCKET_NAME = 'stories-media'; // create this bucket in Supabase Storage first

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

    // 1. Extract media URLs from the source link
    const mediaItems = await extractStoryMedia(url);

    // 2. Find or create the watched_links row
    const { data: existing } = await supabase
      .from('watched_links')
      .select('id')
      .eq('source_url', url)
      .single();

    let linkId: string;
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

    // 3. Download each media item, upload to Storage, and save a row in `stories`
    let savedCount = 0;
    const errors: string[] = [];

    for (const item of mediaItems) {
      try {
        const buffer = await downloadMedia(item.url);

        // content_hash used to dedupe re-fetched stories
        const contentHash = createHash('sha256').update(buffer).digest('hex');

        const extension = item.type === 'video' ? 'mp4' : 'jpg';
        const storagePath = `${linkId}/${contentHash}.${extension}`;

        // Skip upload if this exact content was already archived for this link
        const { data: alreadyExists } = await supabase
          .from('stories')
          .select('id')
          .eq('watched_link_id', linkId)
          .eq('content_hash', contentHash)
          .maybeSingle();

        if (alreadyExists) continue;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, buffer, {
            contentType: item.type === 'video' ? 'video/mp4' : 'image/jpeg',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase
          .from('stories')
          .insert({
            watched_link_id: linkId,
            storage_path: storagePath,
            media_type: item.type,
            content_hash: contentHash,
            file_size_bytes: buffer.length,
            posted_at: item.postedAt ?? null,
          });

        if (insertError) throw insertError;

        savedCount++;
      } catch (itemError: any) {
        console.error('Failed to save media item:', itemError);
        errors.push(itemError.message || 'Unknown error saving media item');
      }
    }

    // 4. Update last_checked_at (and last_new_story_at if we saved something new)
    await supabase
      .from('watched_links')
      .update({
        last_checked_at: new Date().toISOString(),
        ...(savedCount > 0 ? { last_new_story_at: new Date().toISOString() } : {}),
        last_error: errors.length > 0 ? errors.join('; ') : null,
      })
      .eq('id', linkId);

    return NextResponse.json({
      id: linkId,
      source_url: url,
      platform,
      mediaFound: mediaItems.length,
      mediaSaved: savedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Archived ${savedCount} of ${mediaItems.length} media item(s)`,
    });

  } catch (error: any) {
    console.error('Error in /api/links:', error);
    return NextResponse.json({
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
