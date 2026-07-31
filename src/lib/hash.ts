import { createHash } from "crypto";

/**
 * content_hash for the dedupe unique constraint. Prefers a stable id from
 * the extraction source (sourceId) when available, since re-downloading the
 * same story can produce a byte-different file (re-encoding, CDN variance)
 * even though it's the same post — hashing bytes in that case would create
 * duplicate rows for one real story. Falls back to hashing the downloaded
 * bytes when the source gives no stable id.
 */
export function contentHashFromSourceId(sourceId: string): string {
  return createHash("sha256").update(`id:${sourceId}`).digest("hex");
}

export function contentHashFromBytes(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
