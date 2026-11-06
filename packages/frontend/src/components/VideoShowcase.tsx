import { useState } from 'react'
import { Play } from 'lucide-react'
import { videos, youtubeThumbUrl, youtubeWatchUrl, type VideoEntry } from '../content/videos'

/**
 * Click-to-play card. Nothing from YouTube is embedded until the visitor presses play: the card
 * shows the public thumbnail, and only then swaps in a privacy-enhanced (youtube-nocookie) player.
 */
function VideoCard({ video }: { video: VideoEntry }): JSX.Element {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="flex min-w-0 flex-col bg-bg1">
      <div className="relative aspect-video w-full overflow-hidden border-b border-border-low bg-sand-100">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play video: ${video.title}`}
            className="group absolute inset-0 block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <img
              src={youtubeThumbUrl(video.id)}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/10" aria-hidden="true" />
            <span
              className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/75 text-white shadow-lg transition-transform group-hover:scale-110"
              aria-hidden="true"
            >
              <Play className="size-6 translate-x-0.5 fill-current" />
            </span>
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="text-base font-semibold leading-snug text-sand-1600">{video.title}</h3>
        <p className="mt-auto flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
          <span>{video.channel}</span>
          <a
            href={youtubeWatchUrl(video.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-sand-1600"
          >
            Watch on YouTube
          </a>
        </p>
      </div>
    </div>
  )
}

export default function VideoShowcase(): JSX.Element {
  return (
    <div className="grid gap-px overflow-hidden border border-border-low bg-border-low md:grid-cols-2 xl:grid-cols-3">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  )
}
