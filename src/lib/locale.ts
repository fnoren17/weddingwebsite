import { getSiteConfig } from './config';

export const SUPPORTED_LOCALES = ['en', 'sv'] as const;
export type SiteLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SiteLocale = 'en';

export function isSupportedLocale(value: string | undefined | null): value is SiteLocale {
    return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// Site-wide, admin-chosen — not a per-visitor preference. See AGENTS.md: the
// admin sets `locale` in site.json (General Settings), and every visitor sees
// the site in that language.
export async function getUserLocale(): Promise<SiteLocale> {
    const configured = getSiteConfig().locale;
    return isSupportedLocale(configured) ? configured : DEFAULT_LOCALE;
}
