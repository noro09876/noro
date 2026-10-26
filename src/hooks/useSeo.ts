import { useEffect } from 'react';
import seo from '../config/seo.json';
import { SITE } from '../config/site';

type RouteMeta = { title: string; description: string; og: string };

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

/** Keeps title/description/OG in sync on client-side navigation (static HTML has them pre-rendered too). */
export function useSeo(path: string) {
  useEffect(() => {
    const routes = seo.routes as Record<string, RouteMeta>;
    const meta = routes[path] ?? routes['/404']!;
    document.title = meta.title;
    setMeta('name', 'description', meta.description);
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    const origin = SITE.url || window.location.origin;
    setMeta('property', 'og:url', origin + (routes[path] ? path : '/'));
    setMeta('property', 'og:image', origin + meta.og);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (routes[path] && path !== '/404') {
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = origin + path;
    } else link?.remove();
  }, [path]);
}
