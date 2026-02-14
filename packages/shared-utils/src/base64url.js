export function decodeBase64Url(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("base64url input must be a non-empty string");
  }
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }
  return Buffer.from(normalized, "base64");
}

export function encodeBase64Url(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("encodeBase64Url expects a Buffer");
  }
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
