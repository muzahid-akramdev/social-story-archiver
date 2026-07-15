import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// TODO: Replace with your Supabase credentials from env
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function detectPlatform(url: string): Promise<'facebook' | 'instagram'> {
  const lower = url.toLowerCase();
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  if (lower.includes('instagram.com')) return 'instagram';
  throw new Error('Unsupported platform. Only Facebook and Instagram story links are supported.');
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const platform = await detectPlatform(url);

    // Check if already exists
    const { data: existing } = await supabase
      .from('watched_links')
      .select('id, label')
      .eq('source_url', url)
      .single();

    if (existing) {
      // Trigger immediate recheck (TODO: call extraction)
      return NextResponse.json({ 
        id: existing.id, 
        message: 'Link already tracked. Recheck triggered.' 
      });
    }

    // Create new watched link
    const { data, error } = await supabase
      .from('watched_links')
      .insert({
        source_url: url,
        platform,
        label: url.split('/').slice(-1)[0] || 'Untitled',
      })
      .select()
      .single();

    if (error) throw error;

    // TODO: Trigger initial extraction here

    return NextResponse.json({
      id: data.id,
      source_url: data.source_url,
      platform: data.platform,
      label: data.label,
    });

  } catch (error: any) {
    console.error('Error in /api/links:', error);
    return NextResponse.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 });
  }
}
