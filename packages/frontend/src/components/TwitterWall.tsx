import { useRef, useEffect, useCallback } from 'react'

interface Tweet {
  id: string
  author: string
  handle: string
  text: string
  date: string
  url: string
}

// Add more tweets here as you collect them
const TWEETS: Tweet[] = [
  
  {
    id: '2037594925748150422',
    author: 'Noah 🎈',
    handle: 'redacted_noah',
    text: "I think that's a good solution to get off the ground. Once you need to start customizing the way you build instructions, you have seeds IDL can't capture, etc it'll break down.",
    date: 'Mar 27, 2026',
    url: 'https://x.com/redacted_noah/status/2037594925748150422',
  },
  {
    id: '2044854689502503095',
    author: 'metadev',
    handle: 'metadev5',
    text: 'ngl, this is good tech which makes devving easier than ever',
    date: 'Apr 16, 2026',
    url: 'https://x.com/metadev5/status/2044854689502503095',
  },{
    id: '2034772049529327999',
    author: 'Jonas Hahn',
    handle: 'SolPlay_jonas',
    text: 'Cool! How does it work?',
    date: 'Mar 19, 2026',
    url: 'https://x.com/SolPlay_jonas/status/2034772049529327999',
  },{
    id: '2045916121719828637',
    author: 'Gui Bibeau e/acc',
    handle: 'GuiBibeau',
    text: 'Good job seriously! Liking this project a lot!',
    date: 'Apr 19, 2026',
    url: 'https://x.com/GuiBibeau/status/2045916121719828637',
  },
  {
    id: '2046664651929203088',
    author: 'Superteam Turkey',
    handle: 'SuperteamTR',
    text: "Well deserved 🔥 can't wait to see what you ship",
    date: 'Apr 21, 2026',
    url: 'https://x.com/SuperteamTR/status/2046664651929203088',
  },
  {
    id: '2047348375645790412',
    author: 'chris.sol 🇬🇧',
    handle: 'chrisdotsol',
    text: "Wow that's awesome! Thank you!",
    date: 'Apr 23, 2026',
    url: 'https://x.com/chrisdotsol/status/2047348375645790412',
  },
  
]

// Repeat enough times to fill wide screens seamlessly (2 copies for loop)
const TRACK_ITEMS = [...Array(2)].flatMap(() => TWEETS)

const MAX_CHARS = 140
function truncate(text: string): string {
  return text.length <= MAX_CHARS ? text : text.slice(0, MAX_CHARS).trimEnd() + '…'
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.727-8.826L1.667 2.25H8.32l4.259 5.637L18.244 2.25zM17.083 19.77h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  )
}

function TweetCard({ tweet }: { tweet: Tweet }) {
  return (
    <a
      href={tweet.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex-shrink-0 w-80 bg-surface-elevated border border-white/[0.07] rounded-2xl p-5 flex flex-col gap-4 hover:border-primary/25 hover:bg-surface-card transition-all duration-300"
    >
      {/* Author row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={`https://unavatar.io/twitter/${tweet.handle}`}
            alt={tweet.author}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full object-cover bg-surface flex-shrink-0"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${tweet.handle}&backgroundColor=14F195&textColor=0a0f0d`
            }}
          />
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold leading-tight truncate">{tweet.author}</p>
            <p className="text-gray-500 text-xs truncate">@{tweet.handle}</p>
          </div>
        </div>
        <XLogo className="w-[18px] h-[18px] text-gray-600 group-hover:text-[#1d9bf0] transition-colors flex-shrink-0 ml-2" />
      </div>

      {/* Tweet text */}
      <p className="text-gray-300 text-sm leading-relaxed flex-1">{truncate(tweet.text)}</p>

      {/* Date */}
      <p className="text-gray-600 text-xs">{tweet.date}</p>
    </a>
  )
}

export default function TwitterWall() {
  const containerRef = useRef<HTMLDivElement>(null)
  const isPaused = useRef(false)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startScrollLeft = useRef(0)
  const rafRef = useRef<number | null>(null)

  const tick = useCallback(() => {
    const el = containerRef.current
    if (el && !isPaused.current) {
      el.scrollLeft += 1
      // Seamless loop: reset when first half is consumed
      if (el.scrollLeft >= el.scrollWidth / 2) {
        el.scrollLeft = 0
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [tick])

  function onMouseEnter() {
    isPaused.current = true
  }
  function onMouseLeave() {
    isPaused.current = false
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }
  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    isDragging.current = true
    startX.current = e.pageX - (containerRef.current?.offsetLeft ?? 0)
    startScrollLeft.current = containerRef.current?.scrollLeft ?? 0
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
  }
  function onMouseUp() {
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDragging.current || !containerRef.current) return
    e.preventDefault()
    const el = containerRef.current
    const x = e.pageX - el.offsetLeft
    const walk = (x - startX.current) * 1.5
    let next = startScrollLeft.current - walk
    const half = el.scrollWidth / 2
    // Keep within seamless bounds
    if (next < 0) next += half
    if (next >= half) next -= half
    el.scrollLeft = next
  }

  return (
    <div className="relative overflow-hidden">
      {/* Left fade */}
      <div
        className="absolute left-0 top-0 bottom-0 w-32 pointer-events-none z-10"
        style={{ background: 'linear-gradient(to right, #0d1411, transparent)' }}
      />
      {/* Right fade */}
      <div
        className="absolute right-0 top-0 bottom-0 w-32 pointer-events-none z-10"
        style={{ background: 'linear-gradient(to left, #0d1411, transparent)' }}
      />

      {/* Scrollable track */}
      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-scroll pb-1 cursor-grab select-none"
        style={{ scrollbarWidth: 'none' }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
      >
        {/* First copy */}
        {TRACK_ITEMS.map((tweet, i) => (
          <TweetCard key={`a-${tweet.id}-${i}`} tweet={tweet} />
        ))}
        {/* Duplicate for seamless loop */}
        {TRACK_ITEMS.map((tweet, i) => (
          <TweetCard key={`b-${tweet.id}-${i}`} tweet={tweet} />
        ))}
      </div>
    </div>
  )
}
