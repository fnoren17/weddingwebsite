import { getRequestConfig } from 'next-intl/server';
import { getUserLocale } from '@/lib/locale';

// No `[locale]` route segment — every public URL stays exactly what it is
// today (see AGENTS.md). The locale is an admin setting (site.json's
// `locale`, defaulting to English) rather than a per-visitor choice or
// anything derived from the URL, so this ignores the `requestLocale`
// next-intl would normally derive from routing.
export default getRequestConfig(async () => {
    const locale = await getUserLocale();
    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default,
    };
});
