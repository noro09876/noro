/**
 * Site-wide configuration. Contact channels are read from build-time env vars
 * (set them in Netlify → Site configuration → Environment variables):
 *   VITE_SITE_URL          e.g. https://noro.example.com (canonical URLs, sitemap)
 *   VITE_CONTACT_EMAIL     shown as a fallback channel for the order form
 *   VITE_CONTACT_TELEGRAM  Telegram username without @
 * Nothing secret belongs here: these values are public by design.
 */
const env = import.meta.env;

export const SITE = {
  name: 'NORO',
  url: (env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || '',
  contacts: {
    email: (env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || '',
    telegram: (env.VITE_CONTACT_TELEGRAM as string | undefined)?.trim().replace(/^@/, '') || '',
  },
  leadEndpoint: '/api/lead',
} as const;

export const hasContactChannel = Boolean(SITE.contacts.email || SITE.contacts.telegram);
