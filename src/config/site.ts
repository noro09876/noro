/**
 * Site-wide configuration. Contact channels are read from build-time env vars
 * (set them in Netlify → Site configuration → Environment variables):
 *   VITE_SITE_URL          e.g. https://noro.example.com (canonical URLs, sitemap)
 *   VITE_CONTACT_EMAIL     shown as a fallback channel for the order form
 *   VITE_CONTACT_TELEGRAM  Telegram username without @
 * Nothing secret belongs here: these values are public by design.
 * Without env vars the defaults below (NORO's public contacts) are used.
 */
const DEFAULT_EMAIL = '9norostudio9@gmail.com';
const DEFAULT_TELEGRAM = 'Noro23';
const env = import.meta.env;

export const SITE = {
  name: 'NORO',
  url: (env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || '',
  contacts: {
    email: (env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || DEFAULT_EMAIL,
    telegram: (env.VITE_CONTACT_TELEGRAM as string | undefined)?.trim().replace(/^@/, '') || DEFAULT_TELEGRAM,
  },
  leadEndpoint: '/api/lead',
} as const;

export const hasContactChannel = Boolean(SITE.contacts.email || SITE.contacts.telegram);
