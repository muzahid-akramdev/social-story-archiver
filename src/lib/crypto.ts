import crypto from "crypto";

const ALGO = "aes-256-gcm";

/**
 * A Facebook session cookie is equivalent to that person's Facebook
 * password for as long as it's valid, so it's encrypted before storage
 * (see facebook_sessions table, migration 0003) rather than stored as
 * plain text. Key must be a 32-byte value, hex-encoded — generate one
 * with: openssl rand -hex 32
 */
function getKey(): Buffer {
  const hex = process.env.FACEBOOK_COOKIE_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "FACEBOOK_COOKIE_ENCRYPTION_KEY must be set to a 64-character hex " +
        "string (32 bytes). Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(":");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
