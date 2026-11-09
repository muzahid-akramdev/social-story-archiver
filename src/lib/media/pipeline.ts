import sharp from "sharp";
import JSZip from "jszip";

/**
 * v2 media pipeline: compress → thumbnail → bundle.
 *
 * Owner's requirement (2026-11-10): every archived image must land at
 * ≤ 40 KB. The target is PER IMAGE — a crawl ZIP holding n new stories
 * will be roughly n × ≤40 KB. Reference measurement on a real
 * 1080×1920 photo-like frame (1.8 MB PNG): WebP 720/q55 = 49 KB,
 * 640/q50 = 40 KB, 540/q55 = 34 KB; text/gradient stories land far
 * lower (~10–20 KB). The adaptive loop below starts generous and steps
 * down until the image fits, so simple stories keep more resolution
 * and only dense photos pay the full step-down cost.
 */

export const IMAGE_TARGET_BYTES = 40 * 1024;

type Step = { width: number; quality: number };

// Ordered best-quality-first. The loop stops at the first step whose
// output fits the target. The first four steps are the spec's ladder;
// the rest are last-resort step-downs for pathological frames (heavy
// per-pixel noise is nearly incompressible — a synthetic noise frame
// needs them; real photos stop at step 2–3, per the spec measurements).
export const COMPRESSION_STEPS: Step[] = [
  { width: 720, quality: 60 },
  { width: 640, quality: 50 },
  { width: 540, quality: 50 },
  { width: 540, quality: 40 },
  { width: 540, quality: 32 },
  { width: 480, quality: 32 },
  { width: 480, quality: 26 },
  { width: 400, quality: 26 },
  { width: 400, quality: 20 },
];

export type CompressedImage = {
  buffer: Buffer;
  width: number;
  quality: number;
  bytes: number;
  /** Every step actually tried, for logging/demo output. */
  attempts: { width: number; quality: number; bytes: number }[];
};

export async function compressImageToTarget(
  input: Buffer | ArrayBuffer,
  targetBytes: number = IMAGE_TARGET_BYTES
): Promise<CompressedImage> {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const attempts: CompressedImage["attempts"] = [];

  let best: CompressedImage | null = null;

  for (const step of COMPRESSION_STEPS) {
    const buffer = await sharp(src)
      .rotate() // honour EXIF orientation before stripping metadata
      .resize({ width: step.width, withoutEnlargement: true })
      .webp({ quality: step.quality })
      .toBuffer();

    attempts.push({ width: step.width, quality: step.quality, bytes: buffer.length });

    const candidate: CompressedImage = {
      buffer,
      width: step.width,
      quality: step.quality,
      bytes: buffer.length,
      attempts,
    };
    if (!best || candidate.bytes < best.bytes) best = candidate;
    if (buffer.length <= targetBytes) return candidate;
  }

  // Practically unreachable for story-sized inputs, but never fail the
  // archive over it: return the smallest attempt and let the caller log
  // that it exceeded the target.
  return best!;
}

/** Tiny dashboard preview: WebP, width 240 (spec §4 step 4). */
export async function makeThumbnail(
  input: Buffer | ArrayBuffer
): Promise<Buffer> {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return sharp(src)
    .rotate()
    .resize({ width: 240, withoutEnlargement: true })
    .webp({ quality: 50 })
    .toBuffer();
}

export type ZipEntry = { name: string; buffer: Buffer };

/**
 * Bundle one crawl's new stories into a single ZIP. Entries are already
 * WebP-compressed, so DEFLATE at max level adds little — the ZIP is a
 * container, and its size stays ≈ the sum of its (≤40 KB) images.
 */
export async function bundleZip(entries: ZipEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.buffer);
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

/** `label_2026-11-10_0130.zip`-style archive filename, filesystem-safe. */
export function archiveZipName(label: string, when = new Date()): string {
  const safe = label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "stories";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `_${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `${safe}_${stamp}.zip`;
}
