import type { CSSProperties } from 'react'

export function HeroDecor(): JSX.Element {
  return (
    <div className="relative z-10 flex size-[124px] items-center justify-center">
      <img src="/brand/orquestra-v07/1-app-icon.svg" alt="Orquestra" className="h-full w-full" />
    </div>
  )
}

/**
 * Full-viewport pulse lines that cross at the hero hatch box center.
 * Must be placed as a direct child of a `relative` section with
 * `overflow-x-hidden` so the w-screen lines don't cause scroll.
 *
 * Usage in Home.tsx hero section:
 *   <section className="relative overflow-x-hidden ...">
 *     <HeroLines topOffset="calc(6rem + 62px)" />
 *     ...content with HeroDecor inside...
 */
export function HeroLines({ topOffset = 'calc(6rem + 62px)' }: { topOffset?: string }): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {/* Horizontal static hairline */}
      <div
        className="absolute left-1/2 h-px w-screen -translate-x-1/2 bg-border-medium"
        style={{ top: topOffset } as CSSProperties}
      />

      {/* Horizontal pulse beacon */}
      <svg
        className="absolute left-0 w-screen"
        style={{ top: topOffset, height: '2px', overflow: 'visible' } as CSSProperties}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="orq-h-pulse" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="40%" stopColor="rgb(var(--rgb-sand-1600) / 0.55)" />
            <stop offset="60%" stopColor="rgb(var(--rgb-sand-1600) / 0.55)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <rect y="0" height="2" fill="url(#orq-h-pulse)" width="120">
          <animate
            attributeName="x"
            values="-120; calc(100vw + 120px); calc(100vw + 120px)"
            keyTimes="0; 0.85; 1"
            dur="5s"
            begin="0.3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0; 0.9; 0.9; 0"
            keyTimes="0; 0.1; 0.8; 1"
            dur="5s"
            begin="0.3s"
            repeatCount="indefinite"
          />
        </rect>
      </svg>

      {/* Vertical static hairline — top-0 to bottom-0 of the section */}
      <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-border-medium" />

      {/* Vertical pulse beacon */}
      <svg
        className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2"
        style={{ overflow: 'visible' } as CSSProperties}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="orq-v-pulse" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="40%" stopColor="rgb(var(--rgb-sand-1600) / 0.55)" />
            <stop offset="60%" stopColor="rgb(var(--rgb-sand-1600) / 0.55)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <rect x="0" width="1" height="100" fill="url(#orq-v-pulse)">
          <animate
            attributeName="y"
            values="-100; calc(100% + 100px); calc(100% + 100px)"
            keyTimes="0; 0.85; 1"
            dur="5s"
            begin="1.8s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0; 0.9; 0.9; 0"
            keyTimes="0; 0.1; 0.8; 1"
            dur="5s"
            begin="1.8s"
            repeatCount="indefinite"
          />
        </rect>
      </svg>
    </div>
  )
}

export function BrandMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" strokeWidth="1.4" />
      <rect x="3" y="3" width="18" height="18" strokeWidth="1.4" transform="rotate(45 12 12)" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

export function TopFade(): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 top-0 z-0 h-[600px]"
      style={{
        background: 'linear-gradient(to bottom, rgb(var(--rgb-highlight) / 0.55), transparent)',
      }}
      aria-hidden="true"
    />
  )
}
