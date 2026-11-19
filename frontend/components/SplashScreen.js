'use client';

import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';

const SHOW_MS = 1800; // time before the fade-out starts
const FADE_MS = 450;
export const SPLASH_KEY = 'tg-splash-seen';

/**
 * Branded opening splash. Shown once per browser session; an inline script in
 * the root layout marks <html data-splash-seen> before paint on later loads so
 * it never flashes. Tap / click / Escape skips it.
 */
export default function SplashScreen() {
  const [phase, setPhase] = useState('show'); // show | hide | gone

  useEffect(() => {
    if (document.documentElement.dataset.splashSeen) {
      setPhase('gone');
      return undefined;
    }
    try {
      sessionStorage.setItem(SPLASH_KEY, '1');
    } catch {
      /* storage unavailable: splash simply shows on each load */
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t1 = setTimeout(() => setPhase('hide'), reduce ? 600 : SHOW_MS);
    const t2 = setTimeout(() => setPhase('gone'), (reduce ? 600 : SHOW_MS) + FADE_MS);
    const skip = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      setPhase('hide');
      setTimeout(() => setPhase('gone'), FADE_MS);
    };
    window.addEventListener('keydown', skip);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div
      className={`tg-splash ${phase === 'hide' ? 'tg-splash--hide' : ''}`}
      role="status"
      aria-label="ToolkitGo is loading"
      onClick={() => {
        setPhase('hide');
        setTimeout(() => setPhase('gone'), FADE_MS);
      }}
    >
      <div className="tg-splash__glow" aria-hidden="true" />
      <div className="relative flex flex-col items-center px-6 text-center">
        <h1 className="tg-splash__word">
          <BrandLogo tone="dark" size="xl" tagline animated />
        </h1>
        <div className="tg-splash__bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
