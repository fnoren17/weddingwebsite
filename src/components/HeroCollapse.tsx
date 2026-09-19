'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { photoSrc } from '@/lib/photoSrc';

interface HeroCollapseProps {
  images: string[];
  fallbackImage?: string;
  interval?: number;
  bgColor?: string;
  children?: React.ReactNode;
}

// Photo positions — center-anchored offsets (vw/vh) from the sticky container center.
// Each div has negative margin to center it on its anchor, so these are true center offsets.
// Desktop only — narrow mobile screens skip this flourish (see applyProgress).
const SCATTER: { x: number; y: number; rot: number; w: number }[] = [
  { x: -34, y: -24, rot: -7, w: 19 },
  { x:  34, y: -24, rot:  6, w: 19 },
  { x: -34, y:  14, rot:  5, w: 19 },
  { x:  34, y:  14, rot: -7, w: 19 },
];

// Scroll offset so the About section's rounded top clears the fixed nav island
const ABOUT_OFFSET   = 88;

/** Ease in-out cubic — also used by Navigation to keep the nav island's
 *  narrowing in step with the hero image's own collapse curve. */
export function eio(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Scroll the #about band into view, leaving room for the nav island. */
function scrollToAbout(behavior: ScrollBehavior) {
  const el = document.getElementById('about');
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - ABOUT_OFFSET;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

/**
 * Smooth-scroll to a position and run `onArrive` once the page settles.
 *
 * `window.scrollTo({behavior:'smooth'})` has no completion callback, so poll:
 * finish on arrival, on a stall (the user grabbed the page mid-flight), or on a
 * hard timeout. Returns a cancel function. The stall check is held off for the
 * first few frames because the browser hasn't started moving yet — checking
 * immediately would read "not moving" and fire straight away.
 */
function smoothScrollTo(top: number, onArrive: () => void): () => void {
  const target = Math.max(0, top);
  const started = performance.now();
  let raf = 0;
  let cancelled = false;
  let frames = 0;
  let stillFor = 0;
  let last = window.scrollY;

  window.scrollTo({ top: target, behavior: 'smooth' });

  const tick = () => {
    if (cancelled) return;
    frames++;
    const y = window.scrollY;
    stillFor = Math.abs(y - last) < 0.5 ? stillFor + 1 : 0;
    last = y;

    const arrived = Math.abs(y - target) <= 2;
    const stalled = frames > 12 && stillFor > 8;
    const tooLong = performance.now() - started > 1600;

    if (arrived || stalled || tooLong) { onArrive(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => { cancelled = true; cancelAnimationFrame(raf); };
}

export default function HeroCollapse({
  images,
  fallbackImage,
  bgColor = '#ffffff',
  children,
  interval = 5000,
}: HeroCollapseProps) {
  const srcs = images.length > 0 ? images : (fallbackImage ? [fallbackImage] : []);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [firstReady,   setFirstReady]   = useState(false);
  const [isMobile,     setIsMobile]     = useState(false);

  // Scatter frame indices — same rule, one per scatter position: each frame
  // holds its assigned image and only swaps when the slideshow would land on
  // the same image (takes the vacated slide).
  const [scatterIdxs,  setScatterIdxs]  = useState<number[]>(() =>
    SCATTER.map((_, i) => (i + 1) % Math.max(srcs.length, 1))
  );
  // Ref so interval/handlers always read the live current slide
  const currentSlideRef = useRef(0);

  const sectionRef   = useRef<HTMLDivElement>(null);
  const mainImgRef   = useRef<HTMLDivElement>(null);
  const textRef      = useRef<HTMLDivElement>(null);
  const scatterRefs  = useRef<(HTMLDivElement | null)[]>([]);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // In-flight smooth scroll back to the hero (nav Home click while on home)
  const homeScrollRef = useRef<(() => void) | null>(null);
  const cancelHomeScroll = () => {
    if (homeScrollRef.current) {
      homeScrollRef.current();
      homeScrollRef.current = null;
    }
  };

  // ── Detect mobile (also responds to resize / DevTools viewport changes) ──
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // ── Preload images ────────────────────────────────────────────────────────
  useEffect(() => {
    if (srcs.length === 0) return;
    let cancelled = false;
    const first = new window.Image();
    first.src = photoSrc(srcs[0], isMobile ? 'large' : 'xl');
    first.decode()
      .then(() => { if (!cancelled) setFirstReady(true); })
      .catch(() => { if (!cancelled) setFirstReady(true); });
    srcs.slice(1).forEach(s => {
      const i = new window.Image();
      i.src = photoSrc(s, isMobile ? 'small' : 'large');
      i.decode().catch(() => {});
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcs.join(','), isMobile]);

  // ── Slideshow timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!firstReady || srcs.length <= 1) return;
    timerRef.current = setInterval(() => {
      const prev = currentSlideRef.current;
      const next = (prev + 1) % srcs.length;
      currentSlideRef.current = next;
      setCurrentSlide(next);
      // Swap any scatter frame that would duplicate the incoming slide — give it the vacated slide
      setScatterIdxs(idxs => idxs.map(idx => idx === next ? prev : idx));
    }, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [firstReady, srcs.length, interval]);

  // ── Apply visual state to DOM (called from RAF loop) ─────────────────────
  // p is RAW linear 0→1. We apply easing within each element.
  const applyProgress = (p: number) => {
    const e = eio(p); // eased p for main image / text

    // Main image: full viewport → condensed card. Mobile shrinks much less
    // (screens are already narrow) so it settles into a framed photo card
    // instead of the thin strip the same percentages would make on a phone.
    if (mainImgRef.current) {
      if (isMobile) {
        mainImgRef.current.style.width  = `${100 - 12 * e}vw`;
        mainImgRef.current.style.height = `${100 - 25 * e}svh`;
      } else {
        mainImgRef.current.style.width  = `${100 - 64 * e}vw`;
        mainImgRef.current.style.height = `${100 - 20 * e}vh`;
      }
      mainImgRef.current.style.borderRadius = `${e * 20}px`;
      const overlay = mainImgRef.current.querySelector<HTMLElement>('.hero-overlay');
      if (overlay) overlay.style.opacity = String(0.4 - 0.3 * e);
    }

    // Hero text: fade + rise
    if (textRef.current) {
      const tp = Math.max(0, 1 - e * 3);
      textRef.current.style.opacity   = String(tp);
      textRef.current.style.transform = `translateY(${-e * 40}px)`;
    }

    // Scattered photos: fly in/out from off-screen with individual delays + easing
    scatterRefs.current.forEach((el, i) => {
      if (!el) return;
      const delay  = 0.18 + i * 0.10;
      const sp     = Math.max(0, Math.min(1, (p - delay) / 0.38));
      const se     = eio(sp); // eased scatter progress (applies to both in and out)
      const s      = SCATTER[i];
      const startX = s.x < 0 ? -120 : 120;
      el.style.opacity   = String(Math.min(1, sp * 2.5));
      el.style.transform =
        `translate(${startX + (s.x - startX) * se}vw, ${s.y}vh) rotate(${s.rot * se}deg)`;
    });
  };

  // ── Always (re)enter the homepage at the very top ───────────────────────
  // Navigating here from another page (especially while scrolled) could
  // otherwise restore a scrolled position and snap the hero mid-animation.
  // Force the top on mount, unless deep-linking to a hash (e.g. #about).
  // useLayoutEffect + a follow-up rAF beats late browser scroll restoration.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || window.location.hash) return;
    window.scrollTo(0, 0);
    const raf = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Arriving from another page via /#about: teleport straight there ──────
  // Next's own hash handling is unreliable across client-side navigations, so
  // pin the position ourselves. The scroll listeners below then snap the hero
  // to its collapsed state, so the collage is already in place behind us.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#about') return;
    scrollToAbout('instant');
    const raf = requestAnimationFrame(() => scrollToAbout('instant'));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => { cancelHomeScroll(); }, []);

  // ── Scroll-linked collapse ─────────────────────────────────────────────────
  // Progress is derived straight from scroll position — no locked, timed
  // commit that plays out regardless of how far the user actually scrolled.
  // A small scroll gives a small change; scrolling keeps moving toward the
  // content underneath instead of getting stuck in a canned animation. Same
  // mechanism on mobile and desktop — only the tuning constants in
  // applyProgress differ.
  useEffect(() => {
    // The collapse plays out over the section's own height (one viewport) —
    // it scrolls away naturally rather than staying pinned, so the page moves
    // and the collapse animates in the same motion.
    const update = () => {
      const section = sectionRef.current;
      if (!section) return;
      const range = window.innerHeight;
      const raw = (window.scrollY - section.offsetTop) / range;
      const p = Math.max(0, Math.min(1, raw));
      applyProgress(p);
      // Raw linear progress, not eased — Navigation applies the same easing
      // (`eio`, exported above) itself so the nav island narrows in the same
      // curve as the image, not a step behind it.
      window.dispatchEvent(new CustomEvent<number>('hero-progress', { detail: p }));
    };

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // Paint the correct state immediately (handles hash-nav landing mid-scroll)
    update();

    // Reset to the slideshow start — fired when the user clicks "Home" in the
    // nav. A normal smooth scroll to the top; the scroll listener above
    // re-expands the hero as it passes back through the collapse range.
    const onReset = () => {
      cancelHomeScroll();
      if (window.scrollY <= 1) return;
      homeScrollRef.current = smoothScrollTo(0, () => { homeScrollRef.current = null; });
    };

    // "About" clicked in the nav while already on the home page: one smooth
    // scroll straight to #about — the hero collapses and slides away as part
    // of that same scroll, rather than a separate held/paused step.
    const onToAbout = () => {
      cancelHomeScroll();
      scrollToAbout('smooth');
    };

    window.addEventListener('hero-reset', onReset);
    window.addEventListener('hero-to-about', onToAbout);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hero-reset', onReset);
      window.removeEventListener('hero-to-about', onToAbout);
      cancelAnimationFrame(raf);
    };
  // applyProgress's only reactive input is isMobile, already in the deps below —
  // re-defining it every render would tear down/rebuild the scroll listener constantly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // ── Early returns ─────────────────────────────────────────────────────────
  if (srcs.length === 0) {
    return (
      <div style={{ height: '100svh', background: '#1a1a1a' }}
           className="flex items-center justify-center text-gray-400">
        [Add hero photos in admin]
      </div>
    );
  }

  // ── Scroll-away collapse: full-bleed slideshow → condensed card ──────────
  // No sticky pin: the section is exactly one viewport tall and scrolls away
  // like any other content, while applyProgress shrinks/fades it in step with
  // that same scroll — the collapse and the page's own movement happen together.
  // Same mechanism on mobile and desktop; only the shrink amounts in
  // applyProgress differ, and the scatter/dots flourishes are desktop-only.
  return (
    <div
      ref={sectionRef}
      style={{
        position: 'relative',
        height: '100svh',
        overflow: 'hidden',
        backgroundColor: bgColor,
      }}
    >
      {/* ── Top gradient — ensures white nav text is readable ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: '160px', zIndex: 18, pointerEvents: 'none',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 100%)',
      }} />

      {/* ── Scattered photos — each frame crossfades at currentSlide+1+i offset ── */}
      {!isMobile && srcs.length > 1 && SCATTER.map((s, i) => (
        <div
          key={i}
          ref={el => { scatterRefs.current[i] = el; }}
          style={{
            position: 'absolute',
            left: '50%',
            top:  '50%',
            marginLeft: `-${s.w / 2}vw`,
            marginTop:  `-${s.w * (4 / 3) / 2}vh`,
            width:  `${s.w}vw`,
            aspectRatio: '3 / 4',
            overflow: 'hidden',
            borderRadius: '16px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            border: '4px solid white',
            opacity: 0,
            transform: `translate(${s.x < 0 ? -120 : 120}vw, ${s.y}vh) rotate(0deg)`,
            transition: 'none',
            zIndex: 15,
          }}
        >
          {srcs.map((src, j) => (
            <img key={src} src={photoSrc(src, 'medium')} alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                       opacity: j === (scatterIdxs[i] ?? 0) % srcs.length ? 1 : 0,
                       transition: 'opacity 1200ms cubic-bezier(0.4,0,0.2,1)' }} />
          ))}
        </div>
      ))}

      {/* ── Main hero image (starts full-screen, condenses to a card) ── */}
      <div
        ref={mainImgRef}
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '100vw', height: '100svh',
          overflow: 'hidden',
          borderRadius: '0px',
          transition: 'none',
          zIndex: 10,
        }}
      >
        <div className="absolute inset-0 bg-gray-800 z-30 transition-opacity duration-700"
             style={{ opacity: firstReady ? 0 : 1, pointerEvents: 'none' }} />
        {srcs.map((src, i) => (
          <img key={src} src={photoSrc(src, isMobile ? 'large' : 'xl')} alt="Hero"
               fetchPriority={i === 0 ? 'high' : 'low'}
               style={{
                 position: 'absolute', inset: 0,
                 width: '100%', height: '100%', objectFit: 'cover',
                 opacity: i === currentSlide ? 1 : 0,
                 transition: 'opacity 1200ms cubic-bezier(0.4,0,0.2,1)',
                 zIndex: i === currentSlide ? 1 : 0,
               }} />
        ))}
        <div className="hero-overlay absolute inset-0 z-20"
             style={{ background: 'rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
      </div>

      {/* ── Hero text ── */}
      <div
        ref={textRef}
        style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {children}
      </div>

      {/* ── Slide dots ── */}
      {!isMobile && srcs.length > 1 && (
        <div style={{
          position: 'absolute', bottom: '2rem', left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: '8px', zIndex: 25,
        }}>
          {srcs.map((_, i) => (
            <button key={i} onClick={() => {
                      const prev = currentSlideRef.current;
                      if (i === prev) return;
                      currentSlideRef.current = i;
                      setCurrentSlide(i);
                      setScatterIdxs(idxs => idxs.map(idx => idx === i ? prev : idx));
                    }}
                    aria-label={`Slide ${i + 1}`}
                    style={{
                      width: i === currentSlide ? '24px' : '10px', height: '10px',
                      borderRadius: '9999px', border: 'none', cursor: 'pointer', padding: 0,
                      background: i === currentSlide ? 'white' : 'rgba(255,255,255,0.5)',
                      transition: 'all 300ms',
                    }} />
          ))}
        </div>
      )}
    </div>
  );
}
