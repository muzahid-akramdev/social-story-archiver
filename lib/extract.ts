// lib/extract.ts
import axios from 'axios';

export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  id?: string;
  postedAt?: Date;
}

export async function extractStoryMedia(sourceUrl: string, platform: 'facebook' | 'instagram'): Promise<MediaItem[]> {
  console.log(`[Extraction] Processing ${platform} story: ${sourceUrl}`);

  try {
    const response = await axios.get(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.facebook.com/',
        'Sec-Fetch-Mode': 'navigate',
      },
      timeout: 20000,
    });

    // Simple regex for media URLs (Facebook CDN)
    const html = response.data;
    const mediaUrls: string[] = [];

    // Find potential video URLs
    const videoMatches = html.match(/https:\/\/[^"'\s]+\.mp4[^"'\s]*/g) || [];
    // Find image URLs
    const imageMatches = html.match(/https:\/\/[^"'\s]+\.(jpg|jpeg|png|webp)[^"'\s]*/g) || [];

    mediaUrls.push(...videoMatches, ...imageMatches);

    const uniqueUrls = [...new Set(mediaUrls)];

    const media: MediaItem[] = uniqueUrls.map((url, index) => ({
      url: url,
      type: url.includes('.mp4') ? 'video' : 'image',
      id: `media-\( {Date.now()}- \){index}`,
    }));

    if (media.length > 0) {
      return media;
    }

    // Fallback
    return [{
      url: sourceUrl,
      type: 'video',
      id: 'direct-link-' + Date.now(),
    }];

  } catch (error: any) {
    console.error('Extraction failed:', error.message);
    return [{
      url: sourceUrl,
      type: 'video',
      id: 'fallback-' + Date.now(),
    }];
  }
}

// Helper (optional)
export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}
