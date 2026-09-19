interface FooterProps {
    /** Unused for display, kept so the shell's props still type-check. */
    brideName?: string;
    groomName?: string;
    weddingDate?: string;
    weddingLocation?: string;
    footerHeroImage?: string;
    footerHeroImageMobile?: string;
}

import { parseDateParts } from '@/lib/weddingDate';
import { useTranslations } from 'next-intl';

export default function Footer({
    brideName = '',
    groomName = '',
    weddingDate = '',
    footerHeroImage,
    footerHeroImageMobile
}: FooterProps) {
    const t = useTranslations('Footer');
    // The copyright year is the wedding's year, not a number typed into the
    // template in 2026.
    const year = parseDateParts(weddingDate)?.year ?? new Date().getFullYear();
    const couple = brideName && groomName ? `${brideName} & ${groomName}` : '';
    const imageUrl = footerHeroImage
        ? `/api/photos/${footerHeroImage}`
        : '/images/Gemini_Generated_Image_7xzkxd7xzkxd7xzk.png';
    // Falls back to the desktop image on mobile too, until a mobile variant is set.
    const mobileImageUrl = footerHeroImageMobile ? `/api/photos/${footerHeroImageMobile}` : imageUrl;

    return (
        <footer className="bg-white relative min-h-[300px]">
            {/* bg-bottom, not bg-center: the footer is a short, wide strip next to
                much taller source photos, so a centered crop clips the bottom-anchored
                branch decoration off both variants. Anchoring to the bottom keeps it. */}
            <div
                className="hidden md:block absolute inset-0 bg-cover bg-bottom bg-no-repeat"
                style={{ backgroundImage: `url('${imageUrl}')` }}
            />
            <div
                className="md:hidden absolute inset-0 bg-cover bg-bottom bg-no-repeat"
                style={{ backgroundImage: `url('${mobileImageUrl}')` }}
            />
            <div className="relative z-10 max-w-7xl mx-auto pt-24 pb-12 px-4 sm:px-6 md:flex md:items-start md:justify-between lg:px-8">
                <div className="flex justify-center space-x-6 md:order-2">
                    {/* Add social links here if needed */}
                </div>
                <div className="mt-0 md:mt-0 md:order-1 w-full">
                    <p className="text-center text-base text-white font-serif">
                        &copy; {year}{couple ? ` ${couple}.` : ''} {t('tagline')}
                    </p>
                    {/* Required Notice under LICENSE.md: credit to the template's
                        original author must travel with any copy of this site.
                        Always English, regardless of site locale, to avoid a
                        translated credit reading like a mistranslation. */}
                    <p className="mt-3 text-center text-xs text-white/60 font-sans">
                        Built on an open-source template by{' '}
                        <a
                            href="https://github.com/Soccerbeats/weddingwebsite"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--accent-light)] hover:text-[var(--accent)] underline underline-offset-2 transition-colors"
                        >
                            Austin Stanfield
                        </a>
                    </p>
                </div>
            </div>
        </footer>
    );
}
