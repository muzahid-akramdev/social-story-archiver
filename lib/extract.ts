export async function extractStoryMedia(sourceUrl: string): Promise<any[]> {
  console.log(`[External API] Processing story: ${sourceUrl}`);

  try {
    // Using a public Facebook downloader API (fbdown style)
    const apiUrl = `https://api.fbdl.app/v1/facebook?url=${encodeURIComponent(sourceUrl)}`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.success && data.data) {
      return [{
        url: data.data.hd || data.data.sd || sourceUrl,
        type: 'video',
        id: 'fb-' + Date.now(),
      }];
    }
  } catch (e) {
    console.log("External API failed, using fallback");
  }

  // Fallback
  return [{
    url: sourceUrl,
    type: 'video',
    id: 'direct-' + Date.now(),
  }];
}
