/** Ray lengths for the Claude spark, slightly uneven so it reads as hand-drawn rather than a gear. */
export const RAYS = [10, 8, 9.5, 7.5, 10, 8.5, 9, 7.5, 10, 8, 9.5, 8];

/** Start and end of each ray in a 24×24 box centred on 12,12. */
export const rayLines = (inner = 2) =>
  RAYS.map((len, i) => {
    const a = (i / RAYS.length) * 2 * Math.PI;
    return { x1: 12 + Math.cos(a) * inner, y1: 12 + Math.sin(a) * inner, x2: 12 + Math.cos(a) * len, y2: 12 + Math.sin(a) * len };
  });

/**
 * The tab icon: the spark, plus an amber dot while a session needs you. Strokes are thicker than the
 * avatar's so it stays legible at 16px. web/public/favicon.svg is faviconSvg(false), regenerated with
 * `node -e "import('./web/src/favicon.ts').then(m => require('fs').writeFileSync('web/public/favicon.svg', m.faviconSvg(false)))"`.
 */
export function faviconSvg(alert: boolean): string {
  const lines = rayLines()
    .map(l => `<line x1="${l.x1.toFixed(2)}" y1="${l.y1.toFixed(2)}" x2="${l.x2.toFixed(2)}" y2="${l.y2.toFixed(2)}"/>`)
    .join('');
  const dot = alert ? '<circle cx="18.5" cy="18.5" r="5" fill="#fbbf24" stroke="#09090b" stroke-width="1.8"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g stroke="#D97757" stroke-width="2.6" stroke-linecap="round">${lines}</g>${dot}</svg>\n`;
}

export function setFavicon(alert: boolean): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = alert ? `data:image/svg+xml,${encodeURIComponent(faviconSvg(true))}` : '/favicon.svg';
}
