export const PLAYER_PROFILE_MESSAGE_MAX_CHARS = 4000;
export const PLAYER_PROFILE_MEDIA_URL_MAX_CHARS = 1000;

export type PlayerProfileMedia =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'youtube'; source_url: string; embed_url: string }
  | null;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|ogg)$/i;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeNewlines(text: string) {
  return text.replace(/\r\n?/g, '\n');
}

function parseAbsoluteUrl(raw: string) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function sanitizeMarkdownLinkHref(raw: string) {
  const url = parseAbsoluteUrl(raw.trim());
  if (!url) return null;
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') return null;
  return url.toString();
}

function findNext(raw: string, needle: string, start: number) {
  const idx = raw.indexOf(needle, start);
  return idx >= 0 ? idx : null;
}

function renderInlineMarkdown(raw: string, depth = 0): string {
  if (!raw) return '';
  if (depth > 8) return escapeHtml(raw);

  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('**', i)) {
      const end = findNext(raw, '**', i + 2);
      if (end != null && end > i + 2) {
        out += `<strong>${renderInlineMarkdown(raw.slice(i + 2, end), depth + 1)}</strong>`;
        i = end + 2;
        continue;
      }
    }

    if (raw[i] === '*') {
      const end = findNext(raw, '*', i + 1);
      if (end != null && end > i + 1) {
        out += `<em>${renderInlineMarkdown(raw.slice(i + 1, end), depth + 1)}</em>`;
        i = end + 1;
        continue;
      }
    }

    if (raw[i] === '`') {
      const end = findNext(raw, '`', i + 1);
      if (end != null && end > i + 1) {
        out += `<code>${escapeHtml(raw.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    if (raw[i] === '[') {
      const labelEnd = findNext(raw, ']', i + 1);
      if (labelEnd != null && raw[labelEnd + 1] === '(') {
        const urlEnd = findNext(raw, ')', labelEnd + 2);
        if (urlEnd != null) {
          const label = raw.slice(i + 1, labelEnd);
          const href = sanitizeMarkdownLinkHref(raw.slice(labelEnd + 2, urlEnd));
          if (href) {
            out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${renderInlineMarkdown(
              label,
              depth + 1
            )}</a>`;
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    out += escapeHtml(raw[i]);
    i += 1;
  }

  return out;
}

export function normalizePlayerProfileMessageInput(value: unknown) {
  const text = normalizeNewlines(String(value ?? '')).trim();
  return text.length > 0 ? text : null;
}

export function normalizePlayerProfileMediaUrlInput(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const url = parseAbsoluteUrl(raw);
  if (!url) return null;
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  url.hash = '';
  return url.toString();
}

function getYouTubeId(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = parts[0] ?? null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') {
      candidate = url.searchParams.get('v');
    } else if (parts[0] === 'embed' || parts[0] === 'shorts') {
      candidate = parts[1] ?? null;
    }
  }

  if (!candidate) return null;
  return YOUTUBE_ID_RE.test(candidate) ? candidate : null;
}

export function classifyPlayerProfileMedia(urlText: string | null | undefined): PlayerProfileMedia {
  const normalized = normalizePlayerProfileMediaUrlInput(urlText);
  if (!normalized) return null;

  const url = parseAbsoluteUrl(normalized);
  if (!url) return null;

  const youtubeId = getYouTubeId(url);
  if (youtubeId) {
    return {
      kind: 'youtube',
      source_url: normalized,
      embed_url: `https://www.youtube.com/embed/${youtubeId}`
    };
  }

  const path = url.pathname.toLowerCase();
  if (IMAGE_EXT_RE.test(path)) return { kind: 'image', url: normalized };
  if (VIDEO_EXT_RE.test(path)) return { kind: 'video', url: normalized };

  return null;
}

export function renderPlayerProfileMarkdown(markdown: string | null | undefined) {
  const text = normalizePlayerProfileMessageInput(markdown);
  if (!text) return null;

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  const pushParagraph = (paragraphLines: string[]) => {
    if (paragraphLines.length === 0) return;
    const rendered = renderInlineMarkdown(paragraphLines.join('\n')).replace(/\n/g, '<br>');
    out.push(`<p>${rendered}</p>`);
  };

  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }

    const headingMatch = lines[i].match(/^\s*(#{1,3})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push(`<li>${renderInlineMarkdown(itemText)}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*(#{1,3})\s+/.test(lines[i])) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    pushParagraph(paragraphLines);
  }

  return out.length > 0 ? out.join('') : null;
}
