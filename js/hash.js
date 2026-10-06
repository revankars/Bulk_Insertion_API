export async function createIdempotencyKey(file) {
  if (!window.crypto?.subtle) {
    throw new Error("Secure SHA-256 hashing is not available in this browser context.");
  }

  const contents = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", contents);
  const hexadecimal = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return `bdia-${hexadecimal}`;
}
