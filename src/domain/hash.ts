export async function sha256(value: string): Promise<string> {
  const g = globalThis as any;
  if (typeof g !== "undefined" && g.process && g.process.versions?.node) {
    try {
      const cryptoName = "node:crypto";
      const { createHash } = await import(cryptoName);
      return createHash("sha256").update(value).digest("hex");
    } catch {
      // Fallback to WebCrypto if dynamic import fails
    }
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

