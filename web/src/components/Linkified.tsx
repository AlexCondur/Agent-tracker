const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
/** Punctuation at the end of a URL usually ends the sentence, not the URL. */
const TRAILING = /[.,;:!?)\]}]+$/;

/** host/…/last/segments: enough to recognise the link without it filling the title. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const path = segs.length > 3 ? `…/${segs.slice(-2).join('/')}` : segs.join('/');
    return u.host.replace(/^www\./, '') + (path ? `/${path}` : '');
  } catch {
    return url;
  }
}

/**
 * Text with its URLs as links that open in a new tab. Clicks on a link don't reach the card or title
 * around it (which would open the session or start renaming).
 */
export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, '');
    parts.push(text.slice(at, m.index));
    parts.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        className="text-sky-300 hover:underline"
      >
        {shortUrl(url)}
      </a>,
    );
    at = m.index + url.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
