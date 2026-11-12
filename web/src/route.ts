import { useEffect, useState } from 'react';

/**
 * Hash routes: '#' = home, '#<sessionId>' = home with that session open in a dialog (also what
 * notifications link to), '#/history', '#/history/<id>', '#/usage'.
 */
export type Route = { view: 'home'; sessionId?: string } | { view: 'history'; sessionId?: string } | { view: 'usage' };

function parse(hash: string): Route {
  const h = decodeURIComponent(hash.replace(/^#/, ''));
  if (h.startsWith('/history')) return { view: 'history', sessionId: h.split('/')[2] || undefined };
  if (h.startsWith('/usage')) return { view: 'usage' };
  // '#/live' was the old list view; it's home now.
  return { view: 'home', sessionId: h && !h.startsWith('/') ? h : undefined };
}

export function href(r: Route): string {
  if (r.view === 'history') return r.sessionId ? `#/history/${r.sessionId}` : '#/history';
  if (r.view === 'usage') return '#/usage';
  return r.sessionId ? `#${encodeURIComponent(r.sessionId)}` : '#';
}

export function navigate(r: Route): void {
  location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
