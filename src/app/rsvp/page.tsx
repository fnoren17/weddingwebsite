import { getSiteConfig } from '@/lib/config';
import RSVPForm from '@/components/RSVPForm';
import { getTranslations, getFormatter } from 'next-intl/server';

// Read live config at request time (admin edits to the RSVP deadline, room block,
// etc. take effect without a rebuild) instead of baking it in at build time.
export const dynamic = 'force-dynamic';

// Parses the deadline and computes whole days remaining (local time).
// Accepts an ISO date (YYYY-MM-DD, from the date picker) or legacy free text.
function parseDeadline(raw?: string): { date: Date | null; freeText: string; daysRemaining: number | null } {
    if (!raw) return { date: null, freeText: '', daysRemaining: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: null, freeText: raw, daysRemaining: null };
    const [y, m, d] = raw.split('-').map(Number);
    const deadline = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysRemaining = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
    return { date: deadline, freeText: '', daysRemaining };
}

export default async function RSVPPage() {
    const config = getSiteConfig();
    const t = await getTranslations('RSVP');
    const format = await getFormatter();
    const bgColor = config.pageBgColors?.rsvp || '#ffffff';
    // Set in General Settings; the previous default was this couple's real
    // address hard-coded into the template.
    const contactEmail = (config.contactEmail ?? 'heav.aust.wedding@gmail.com').trim();

    const { date: deadlineDate, freeText, daysRemaining } = parseDeadline(config.rsvpDeadline);
    const deadlineText = deadlineDate
        ? format.dateTime(deadlineDate, { year: 'numeric', month: 'long', day: 'numeric' })
        : freeText;
    let countdown = '';
    if (daysRemaining !== null) {
        if (daysRemaining >= 1) countdown = t('daysAway', { count: daysRemaining });
        else if (daysRemaining === 0) countdown = t('todaySuffix');
        else countdown = t('closedSuffix');
    }

    return (
        <div style={{ backgroundColor: bgColor }} className="min-h-screen py-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="max-w-3xl mx-auto">
                    <div className="text-center mb-12">
                        <h1 className="text-4xl font-serif text-gray-900 tracking-tight sm:text-5xl">
                            {t('title')}
                        </h1>
                        <p className="mt-4 text-lg text-gray-600">
                            {t('introCantWait')}{' '}
                            {deadlineText
                                ? <>{t('pleaseLetUsKnowByDeadline', { deadline: deadlineText })}{countdown}</>
                                : t('pleaseLetUsKnowSimple')}
                        </p>
                    </div>

                    <RSVPForm
                        coupleNames={`${config.brideName} & ${config.groomName}`}
                        roomBlockHotel={config.roomBlockHotel || ''}
                        roomBlockUrl={config.roomBlockUrl || ''}
                    />

                    {contactEmail && (
                        <div className="mt-12 text-center text-gray-500">
                            <p>
                                {t.rich('troubleRsvping', {
                                    email: contactEmail,
                                    emailLink: (chunks) => (
                                        <a href={`mailto:${contactEmail}`} className="text-accent hover:text-accent-dark">{chunks}</a>
                                    ),
                                })}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
