/**
 * ToolkitGo wordmark: "Toolkit" (navy) + "Go" (orange) with the two speed
 * lines in front of the T, optional tagline. Rendered as text + shapes so it
 * stays crisp at any size and works on light and dark backgrounds.
 *
 * To use the official artwork instead, drop the SVG in /public/brand and
 * render it here; every screen uses this component.
 */
const SIZES = {
  sm: { word: 'text-[1.6rem]', tag: 'text-[0.38rem] tracking-[0.14em] mt-0.5' },
  md: { word: 'text-4xl', tag: 'text-[0.52rem] tracking-[0.15em] mt-1' },
  xl: { word: 'text-5xl sm:text-7xl', tag: 'text-[0.6rem] sm:text-[0.78rem] tracking-[0.15em] mt-2 sm:mt-3' },
};

export default function BrandLogo({ tone = 'light', size = 'sm', tagline = false, animated = false, className = '' }) {
  const s = SIZES[size];
  const navy = tone === 'dark' ? 'text-white' : 'text-logo-navy';
  const navyBg = tone === 'dark' ? 'bg-white' : 'bg-logo-navy';
  const tagColor = tone === 'dark' ? 'text-ink-300' : 'text-logo-navy';

  return (
    <span role="img" aria-label="ToolkitGo" className={`inline-flex flex-col items-center font-brand leading-none ${className}`}>
      <span className={`relative inline-flex items-baseline font-extrabold tracking-[-0.035em] ${s.word}`} aria-hidden="true">
        {/* speed lines */}
        {/* top line: short dash + bar that runs into the T's crossbar; orange line indented below */}
        <span className={`absolute left-[-0.4em] top-[0.125em] flex flex-col gap-[0.055em] ${animated ? 'tg-speed' : ''}`}>
          <span className="flex items-center gap-[0.04em]">
            <span className={`block h-[0.105em] w-[0.1em] rounded-full ${navyBg}`} />
            <span className={`block h-[0.105em] w-[0.3em] rounded-l-full ${navyBg}`} />
          </span>
          <span className="ml-[0.12em] block h-[0.105em] w-[0.2em] rounded-full bg-logo-orange" />
        </span>
        <span className={navy}>Toolkit</span>
        <span className="text-logo-orange">Go</span>
      </span>
      {tagline && <span className={`block whitespace-nowrap font-medium uppercase ${s.tag} ${tagColor}`}>Simplifying everyday services.</span>}
    </span>
  );
}
