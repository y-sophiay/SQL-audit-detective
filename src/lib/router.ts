import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'board' } | { name: 'case'; id: number } | { name: 'sandbox' } | { name: 'report' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'board') return { name: 'board' };
  if (parts[0] === 'case' && Number.isInteger(Number(parts[1]))) return { name: 'case', id: Number(parts[1]) };
  if (parts[0] === 'sandbox') return { name: 'sandbox' };
  if (parts[0] === 'report') return { name: 'report' };
  return { name: 'home' };
}

export const hrefFor = (r: Route): string => {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'case':
      return `#/case/${r.id}`;
    default:
      return `#/${r.name}`;
  }
};

export const go = (r: Route) => {
  location.hash = hrefFor(r);
};

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
