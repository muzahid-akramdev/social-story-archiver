/**
 * Compression demo — `npm run demo:compress`
 *
 * Builds two synthetic 1080×1920 story frames (a photo-like noisy frame
 * and a text/gradient-style frame), runs the real v2 pipeline
 * (src/lib/media/pipeline.ts) on them, and prints every size:
 * per-step attempts, final ≤40 KB results, thumbnails, and a 3-image
 * ZIP bundle. No network, no Supabase, no Facebook.
 *
 * Run with: npx tsx scripts/compress-demo.ts   (or the npm script)
 */
import sharp from "sharp";
import {
  compressImageToTarget,
  makeThumbnail,
  bundleZip,
  IMAGE_TARGET_BYTES,
} from "../src/lib/media/pipeline";

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** Photo-like frame: vertical gradient + heavy random noise (hard case). */
async function photoLikeFrame(): Promise<Buffer> {
  const w = 1080;
  const h = 1920;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const noise = (Math.random() - 0.5) * 90;
      raw[i] = Math.max(0, Math.min(255, 40 + (y / h) * 120 + noise));
      raw[i + 1] = Math.max(0, Math.min(255, 60 + (x / w) * 80 + noise));
      raw[i + 2] = Math.max(0, Math.min(255, 120 + noise));
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

/** Text/gradient story frame: smooth dark gradient (easy case). */
async function gradientFrame(): Promise<Buffer> {
  const svg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b1055"/><stop offset="1" stop-color="#000000"/>
    </linearGradient></defs>
    <rect width="1080" height="1920" fill="url(#g)"/>
    <text x="540" y="900" font-size="90" fill="#ffffff" text-anchor="middle"
      font-family="sans-serif">which track actually!?</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  console.log(`Target: ≤ ${kb(IMAGE_TARGET_BYTES)} per image\n`);

  const frames: { name: string; png: Buffer }[] = [
    { name: "photo-like frame (1080×1920, noisy)", png: await photoLikeFrame() },
    { name: "gradient/text frame (1080×1920)", png: await gradientFrame() },
  ];

  const zipBuffers: { name: string; buffer: Buffer }[] = [];

  for (const frame of frames) {
    console.log(`— ${frame.name}`);
    console.log(`  original PNG: ${kb(frame.png.length)}`);
    const out = await compressImageToTarget(frame.png);
    for (const a of out.attempts) {
      console.log(
        `    try width ${a.width} q${a.quality}: ${kb(a.bytes)}` +
          (a.bytes <= IMAGE_TARGET_BYTES ? "  ✓ fits" : "")
      );
    }
    console.log(
      `  FINAL: ${kb(out.bytes)} at width ${out.width} q${out.quality} ` +
        (out.bytes <= IMAGE_TARGET_BYTES ? "✓ ≤40 KB" : "✗ ABOVE TARGET")
    );
    const thumb = await makeThumbnail(frame.png);
    console.log(`  thumbnail (240w): ${kb(thumb.length)}`);
    zipBuffers.push({ name: `${frame.name.split(" ")[0]}.webp`, buffer: out.buffer });
    console.log();
  }

  // Bundle: 3 images in one crawl ZIP (reuse the photo frame twice with
  // the gradient — a realistic mixed crawl of 3 new stories).
  const third = await compressImageToTarget(frames[0].png);
  const zip = await bundleZip([
    ...zipBuffers,
    { name: "photo-like-2.webp", buffer: third.buffer },
  ]);
  console.log(`— ZIP bundle of 3 compressed stories: ${kb(zip.length)} total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
