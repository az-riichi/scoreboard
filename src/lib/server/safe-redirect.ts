export function sanitizeLocalRedirect(value: unknown): string | null {
  const next = String(value ?? '').trim();
  if (!next.startsWith('/') || next.startsWith('//')) return null;

  let decoded = next;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const candidate = decodeURIComponent(decoded);
      if (candidate === decoded) break;
      decoded = candidate;
    }
  } catch {
    return null;
  }

  if (decoded.startsWith('//') || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) {
    return null;
  }

  try {
    const base = new URL('https://local.invalid');
    const resolved = new URL(next, base);
    if (resolved.origin !== base.origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
