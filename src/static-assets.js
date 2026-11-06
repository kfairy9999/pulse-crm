// Exact public file allowlist. Hashed build files under /assets/ plus the
// sign-in shell, which the router serves only for /, /index.html, and /signin.
export const assetTypes = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};
export const SHELL_PATH = "/index.html";
export const shellContentType = "text/html; charset=utf-8";
const decoded = new Map();

export function publicAsset(path) {
  return (
    /^\/assets\/[A-Za-z0-9_.-]+$/.test(path) &&
    Object.keys(assetTypes).some((ext) => path.endsWith(ext))
  );
}
export function contentTypeForPath(pathname) {
  if (pathname === SHELL_PATH) return shellContentType;
  const ext = Object.keys(assetTypes).find((item) => pathname.endsWith(item));
  return ext ? assetTypes[ext] : null;
}
function assetBytes(pathname, entry) {
  if (entry.encoding !== "base64") return entry.body;
  let bytes = decoded.get(pathname);
  if (!bytes) {
    const binary = atob(entry.body);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    decoded.set(pathname, bytes);
  }
  return bytes;
}
export function bundledAssetResponse(assets, pathname, method) {
  if (method !== "GET" && method !== "HEAD")
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  const entry =
    (pathname === SHELL_PATH || publicAsset(pathname)) && assets?.[pathname];
  if (!entry || entry.contentType !== contentTypeForPath(pathname))
    return new Response(null, { status: 404 });
  return new Response(method === "HEAD" ? null : assetBytes(pathname, entry), {
    status: 200,
    headers: { "Content-Type": entry.contentType },
  });
}
export async function fetchAsset(
  request,
  env,
  pathname,
  bundledAssets,
  method = request.method,
) {
  const assets = env?.ASSETS;
  if (assets && typeof assets.fetch === "function") {
    const url = new URL(pathname, request.url);
    const samePath = new URL(request.url).pathname === pathname;
    const outbound =
      samePath && method === request.method
        ? request
        : new Request(url, { method });
    return assets.fetch(outbound);
  }
  return bundledAssetResponse(bundledAssets, pathname, method);
}
