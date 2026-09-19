'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useRef, CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { eio } from './HeroCollapse';

// Height the fixed nav island occupies (12px top offset + 68px tall). Content
// scrolled to sits below this, so scrollspy detection starts here too — the
// same offset HeroCollapse uses when it scrolls to #about.
const NAV_OFFSET = 88;

interface NavigationProps {
    brideName?: string;
    groomName?: string;
    logoMode?: boolean;
    weddingLogo?: string;
    isAdmin?: boolean;
    /**
     * The demo instance. The admin button is always offered — the whole point of
     * the demo is that anyone can walk into the admin panel, and a button they
     * cannot see is a door they will not find. Kept separate from `isAdmin`
     * rather than folded into it, because that flag also decides which pages the
     * nav lists, and a visitor should see the site as a guest sees it.
     */
    isDemo?: boolean;
}

export default function Navigation({
    brideName = 'Sarah',
    groomName = 'James',
    logoMode = false,
    weddingLogo = '',
    isAdmin = false,
    isDemo = false,
}: NavigationProps) {
    const [isOpen, setIsOpen]       = useState(false);
    const [basicMode, setBasicMode] = useState(false);
    const [registryEnabled, setReg] = useState(false);
    const [hiddenPaths, setHidden]  = useState<Set<string>>(new Set());
    const [scrolled, setScrolled]   = useState(false);
    // Continuous 0→1 "island-ness" while on the home page, driven frame-by-frame
    // by the hero's own scroll progress (see the 'hero-progress' listener below)
    // instead of a boolean flip — so the nav's narrowing tracks the image's
    // collapse exactly rather than snapping in after it via a CSS transition.
    const [heroT, setHeroT] = useState(0);
    const [pillWidth, setPillWidth] = useState(0);
    const logoRef  = useRef<HTMLDivElement>(null);
    const linksRef = useRef<HTMLDivElement>(null);
    const pathname = usePathname();
    const [aboutInView, setAboutInView] = useState(false);
    const t = useTranslations('Navigation');

    // On the home page the hero drives the factor continuously; everywhere else
    // it's a plain threshold flip (there's no image to stay in sync with there).
    const factor = pathname === '/' ? heroT : (scrolled ? 1 : 0);
    const island = factor > 0.5;

    useEffect(() => {
        fetch('/api/admin/site-config')
            .then(r => r.json())
            .then(d => { setBasicMode(d.basicMode || false); setReg(d.registry?.enabled || false); })
            .catch(() => {});
        if (!isAdmin) {
            fetch('/api/wip-status')
                .then(r => r.json())
                .then((d: Record<string, { is_hidden: boolean }>) =>
                    setHidden(new Set(Object.entries(d).filter(([, v]) => v.is_hidden).map(([k]) => k))))
                .catch(() => {});
        }
    }, [isAdmin]);

    // Listen for scroll changes
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 60);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Sync with the hero collapse animation on the home page: HeroCollapse
    // dispatches raw scroll progress (0→1) every frame it updates itself, and
    // applying the same easing curve here (`eio`) keeps the nav's narrowing
    // pixel-in-step with the image instead of lagging a fixed-duration
    // transition behind it.
    useEffect(() => {
        const onProgress = (e: Event) => setHeroT(eio((e as CustomEvent<number>).detail));
        window.addEventListener('hero-progress', onProgress);
        return () => window.removeEventListener('hero-progress', onProgress);
    }, []);

    // On every route change: re-check actual scroll position.
    // Navigation lives in the layout and never unmounts, so `scrolled` state
    // would carry over from the previous page without this reset.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setScrolled(window.scrollY > 60);
        setIsOpen(false);
    }, [pathname]);

    // Track whether the #about section is visible so we can highlight the About nav link.
    //
    // Watches a thin band just under the fixed nav rather than a share of the
    // section. It used to be `threshold: 0.2`, but #about is the whole About
    // region — header, How We Met, Venue, FAQ — around 4000px tall, so landing
    // on it makes visible only (viewportHeight - NAV_OFFSET) / 4000 of it.
    // That clears 0.2 solely on viewports taller than ~890px: the link
    // highlighted on a 1440p screen and silently stayed dark on 1080p, and the
    // cutoff moved whenever anyone edited an FAQ. Whether the section spans a
    // fixed band depends on neither the section's height nor the viewport's.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (pathname !== '/') { setAboutInView(false); return; }
        const el = document.getElementById('about');
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setAboutInView(entry.isIntersecting),
            { rootMargin: `-${NAV_OFFSET}px 0px -70% 0px`, threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [pathname]);

    // `wipPath` is the key the About link is hidden/gated under. It differs
    // from `href` because About isn't its own route — the link jumps to the
    // #about section of the home page, but wip_toggles (and the WIP control
    // page) know it only as `/about`.
    const allLinks = [
        { href: '/', label: t('home') },
        { href: '/#about', wipPath: '/about', label: t('about') },
        { href: '/our-story', label: t('ourStory') },
        { href: '/wedding-party', label: t('weddingParty') },
        { href: '/schedule', label: t('schedule') },
        { href: '/photos', label: t('photos') },
        { href: '/registry', label: t('registry') },
        { href: '/rsvp', label: t('rsvp') },
    ];
    const basicModePages = ['/', '/#about', '/our-story', '/photos'];
    const links = (basicMode && !isAdmin
        ? allLinks.filter(l => basicModePages.includes(l.href))
        : allLinks
    ).filter(l => l.href !== '/registry' || registryEnabled || isAdmin)
     .filter(l => isAdmin || !hiddenPaths.has(l.wipPath ?? l.href));

    // Nav link click side-effects.
    //  • Home            → reset the hero back to the full slideshow
    //  • About, on home  → play the collapse animation, pause, glide to #about
    //  • About, elsewhere→ let the /#about link through; HeroCollapse teleports
    const onNavClick = (href: string) => (e: ReactMouseEvent) => {
        if (href === '/') {
            // Already home: swallow the click so Next doesn't snap the page to
            // the top — HeroCollapse glides there and replays the hero instead.
            if (pathname === '/') e.preventDefault();
            window.dispatchEvent(new CustomEvent('hero-reset'));
            return;
        }
        if (href === '/#about' && pathname === '/') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('hero-to-about'));
        }
    };

    const isActive = (href: string) => {
        if (href === '/#about') return aboutInView;
        if (href === '/') return pathname === '/' && !aboutInView;
        return pathname?.startsWith(href);
    };

    // Measure content width so the island hugs the logo + links tightly.
    // 56px = 28px padding each side, 32px = gap between logo and links.
    useEffect(() => {
        const measure = () => {
            const lw = logoRef.current?.offsetWidth  ?? 0;
            const rw = linksRef.current?.offsetWidth ?? 0;
            if (lw + rw > 0) setPillWidth(lw + rw + 56 + 32);
        };
        measure();
        const t = setTimeout(measure, 150);
        return () => clearTimeout(t);
    }, [links.length, logoMode, weddingLogo, isAdmin]);

    // ── Positioning ────────────────────────────────────────────────────────────
    // Full-bar:  left:0  right:0  top:0   → edge-to-edge banner
    // Island desktop: centered pill sized to content via calc(50% - halfWidth)
    // Island mobile:  edge-to-edge with 16px insets (logo + hamburger need full width)
    const INSET = 16;
    const halfPill = Math.round((pillWidth || 600) / 2);
    // On mobile (no desktop links visible) always use inset style so hamburger fits
    const [isMobileNav, setIsMobileNav] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const update = () => setIsMobileNav(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    // `calc((50% - Xpx) * factor)` keeps the endpoint's live "50%" (so it still
    // re-centers correctly on resize) while scaling the whole inset by our own
    // continuous factor instead of jumping straight to it — at factor 0 this is
    // 0 (edge-to-edge), at factor 1 it's exactly the old island inset.
    const islandL = isMobileNav ? `calc(${INSET}px * ${factor})` : `calc((50% - ${halfPill}px) * ${factor})`;
    const islandR = islandL;
    const topPx    = 12 * factor;
    const heightPx = 80 - 12 * factor; // top + height stays 80 at every factor — only the top edge floats in
    const paddingX = 24 + 4 * factor;

    const barStyle: CSSProperties = {
        position: 'fixed',
        // Plus the demo banner, which is 0px unless this is the demo instance.
        // The banner sits above the nav in the normal flow; a fixed bar knows
        // nothing about flow, so it has to be told — otherwise the banner is
        // drawn straight over the top of the nav island.
        top:   `calc(${topPx}px + var(--demo-banner-h, 0px))`,
        left:  islandL,
        right: islandR,
        zIndex: 50,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:     '32px',
        padding: `0 ${paddingX}px`,
        height:  `${heightPx}px`,
        background:           'rgba(255,255,255,0.88)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: `${20 * factor}px`,
        boxShadow: island
            ? '0 8px 40px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.8) inset'
            : '0 1px 3px rgba(0,0,0,0.06)',
        border: island ? '1px solid rgba(255,255,255,0.65)' : 'none',
        // The geometry above is already updated every frame in lockstep with the
        // hero's own scroll-driven animation on the home page — a CSS transition
        // on it there would just add a lag behind that sync. Off the home page
        // (a plain scrolled-past-60px flip) it's a discrete jump, so it keeps its
        // animated transition. box-shadow/border still flip in both cases.
        transition: pathname === '/'
            ? 'box-shadow 300ms ease, border 300ms ease'
            : 'top 500ms ease, left 500ms ease, right 500ms ease, height 500ms ease, border-radius 500ms ease, box-shadow 500ms ease, border 500ms ease, padding 500ms ease',
    };

    const linkColor   = '#111827';
    const activeColor = 'var(--accent)';
    const underlineBg = 'var(--accent)';
    const hoverBg     = 'rgba(212,175,55,0.3)';

    // Mobile drawer: sits just below the bar — top + height, which is 80 at
    // every factor (see heightPx above). The drawer hangs off this, so it
    // inherits the banner offset through the same variable rather than being
    // adjusted separately.
    const barBottom = topPx + heightPx;
    const drawerTop = `calc(${barBottom + 4}px + var(--demo-banner-h, 0px))`;

    return (
        <>
            {/* ── Nav bar ── */}
            <div style={barStyle}>

                {/* Logo */}
                <div ref={logoRef} style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <Link
                        href="/"
                        onClick={onNavClick('/')}
                        className={logoMode && weddingLogo
                            ? 'block py-1'
                            : 'font-serif text-2xl font-bold tracking-tighter'}
                        style={{ color: 'var(--accent)' }}
                    >
                        {logoMode && weddingLogo ? (
                            <Image
                                src={`/api/photos/${weddingLogo}`}
                                alt="Wedding Logo"
                                width={400}
                                height={72}
                                className="h-[72px] w-auto object-contain"
                                unoptimized
                            />
                        ) : (
                            <>{brideName} & {groomName}</>
                        )}
                    </Link>
                </div>

                {/* Desktop links */}
                <div ref={linksRef} className="hidden md:flex items-center" style={{ gap: '4px' }}>
                    {links.map(link => {
                        const active = isActive(link.href);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={onNavClick(link.href)}
                                className="relative px-3 py-2 text-sm font-medium uppercase tracking-widest group whitespace-nowrap"
                                style={{
                                    color: active ? activeColor : linkColor,
                                    transition: 'color 300ms ease',
                                }}
                            >
                                {link.label}
                                <span
                                    className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full origin-left transition-all duration-300"
                                    style={{
                                        background: underlineBg,
                                        transform:  active ? 'scaleX(1)' : 'scaleX(0)',
                                        opacity:    active ? 1 : 0,
                                    }}
                                />
                                {!active && (
                                    <span
                                        className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-200"
                                        style={{ background: hoverBg }}
                                    />
                                )}
                            </Link>
                        );
                    })}
                    {(isAdmin || isDemo) && (
                        <Link
                            href="/admin"
                            className="ml-2 px-4 py-1.5 rounded-full bg-accent text-white text-xs font-bold uppercase tracking-widest hover:bg-accent-dark transition-colors shadow"
                        >
                            {t('admin')}
                        </Link>
                    )}
                </div>

                {/* Mobile hamburger */}
                <div className="flex items-center gap-3 md:hidden">
                    {(isAdmin || isDemo) && (
                        <Link
                            href="/admin"
                            className="px-3 py-1 rounded-full bg-accent text-white text-xs font-bold uppercase tracking-widest hover:bg-accent-dark transition-colors shadow"
                        >
                            {t('admin')}
                        </Link>
                    )}
                    <button
                        onClick={() => setIsOpen(o => !o)}
                        type="button"
                        className="inline-flex items-center justify-center p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent"
                        style={{ color: '#374151' }}
                        aria-controls="mobile-menu"
                        aria-expanded={isOpen}
                    >
                        <span className="sr-only">{t('openMenu')}</span>
                        <div className="relative w-6 h-5 flex flex-col justify-between">
                            <span className={`block h-0.5 bg-current rounded-full transition-all duration-300 origin-center ${isOpen ? 'rotate-45 translate-y-2.5' : ''}`} />
                            <span className={`block h-0.5 bg-current rounded-full transition-all duration-200 ${isOpen ? 'opacity-0 scale-x-0' : ''}`} />
                            <span className={`block h-0.5 bg-current rounded-full transition-all duration-300 origin-center ${isOpen ? '-rotate-45 -translate-y-2' : ''}`} />
                        </div>
                    </button>
                </div>

            </div>

            {/* ── Mobile drawer ── */}
            <div
                id="mobile-menu"
                className="fixed md:hidden overflow-hidden"
                style={{
                    top:       drawerTop,
                    left:      islandL,
                    right:     islandR,
                    zIndex:    49,
                    maxHeight: isOpen ? '500px' : '0px',
                    opacity:   isOpen ? 1 : 0,
                    borderRadius: island ? '0 0 20px 20px' : '0',
                    transition: 'max-height 300ms ease, opacity 200ms ease, top 500ms ease, left 500ms ease, right 500ms ease',
                }}
            >
                <div className="bg-white/95 backdrop-blur-xl border border-white/60 shadow-xl px-2 pt-2 pb-3 space-y-1 sm:px-3">
                    {links.map((link, i) => {
                        const active = isActive(link.href);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={e => { setIsOpen(false); onNavClick(link.href)(e); }}
                                className={`block px-4 py-3 rounded-lg text-base font-medium uppercase tracking-widest text-center transition-all duration-200 ${
                                    active ? 'text-accent bg-accent/5' : 'text-gray-900 hover:text-accent hover:bg-gray-50'
                                }`}
                                style={{
                                    transitionDelay: isOpen ? `${i * 30}ms` : '0ms',
                                    transform: isOpen ? 'translateY(0)' : 'translateY(-8px)',
                                    opacity:   isOpen ? 1 : 0,
                                }}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
