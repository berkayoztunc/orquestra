import { useState } from 'react'
import { Play } from 'lucide-react'
import { videos, xVideos, youtubeThumbUrl, youtubeWatchUrl, type VideoEntry, type XVideoEntry } from '../content/videos'

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
              className="absolute bottom-3 left-3 flex size-9 items-center justify-center rounded-full bg-black/75 text-white shadow-lg transition-transform duration-200 group-hover:scale-110"
              aria-hidden="true"
            >
              <Play className="size-4 translate-x-px fill-current" />
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

/** Demo that lives on X. Opens the post in a new tab, so no third-party widget is loaded on the page. */
function XVideoCard({ video }: { video: XVideoEntry }): JSX.Element {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 flex-col bg-bg1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative aspect-video w-full overflow-hidden border-b border-border-low bg-sand-1600">
        <img
          src={video.thumb}
          alt={`Poster of ${video.author}'s demo video on X`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/10" aria-hidden="true" />
        <span
          className="absolute bottom-3 left-3 flex size-9 items-center justify-center rounded-full bg-black/75 text-white shadow-lg transition-transform duration-200 group-hover:scale-110"
          aria-hidden="true"
        >
          <Play className="size-4 translate-x-px fill-current" />
        </span>
        <span className="absolute left-3 top-3 bg-black/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white">Demo on X</span>
        <span className="absolute bottom-3 right-3 bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{video.duration}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="text-base font-semibold leading-snug text-sand-1600">{video.title}</h3>
        <p className="mt-auto flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">
          <span>
            {video.author} · {video.date}
          </span>
          <span className="underline underline-offset-4 group-hover:text-sand-1600">Watch on X ↗</span>
        </p>
      </div>
    </a>
  )
}

export default function VideoShowcase(): JSX.Element {
  return (
    <div className="grid gap-px overflow-hidden border border-border-low bg-border-low md:grid-cols-2 xl:grid-cols-4">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
      {xVideos.map((video) => (
        <XVideoCard key={video.url} video={video} />
      ))}
    </div>
  )
}
