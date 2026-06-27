import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  // Use SSH_ENCRYPTION_KEY or AUTH_SECRET from env, fallback to default secret if none is defined
  const secret = process.env.SSH_ENCRYPTION_KEY || process.env.AUTH_SECRET || "srvly-default-fallback-secret-key-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a string using AES-256-GCM.
 * Output format: enc:iv_hex:tag_hex:ciphertext_hex
 */
export function encryptKey(text: string): string {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `enc:${iv.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with encryptKey.
 * Supports backward compatibility: if string does not start with "enc:", returns it as-is.
 */
export function decryptKey(encryptedText: string): string {
  if (!encryptedText) return "";
  if (!encryptedText.startsWith("enc:")) {
    // Return plaintext key for backward compatibility
    return encryptedText;
  }

  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 4) return encryptedText;
    const [, ivHex, tagHex, ciphertextHex] = parts;
    
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Failed to decrypt SSH key:", err);
    // If decryption fails (e.g. secret changed), return the encrypted string as-is
    return encryptedText;
  }
}
