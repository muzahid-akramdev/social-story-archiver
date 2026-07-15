export async function extractStoryMedia(sourceUrl: string): Promise<any[]> {
  console.log(`Trying to extract: ${sourceUrl}`);
  
  // For now, return the original link as fallback so you can see it works
  return [{
    url: sourceUrl,
    type: 'video',
    id: 'story-' + Date.now(),
  }];
}
