/**
 * Videos shown on the homepage (and listed in the README). To add one, append an entry here and
 * mirror it in the README "Videos" section.
 */
export interface VideoEntry {
  /** YouTube video id (the `v=` value). */
  id: string
  title: string
  channel: string
}

/** A demo video that lives in an X post (nothing from X is loaded until the visitor opens the link). */
export interface XVideoEntry {
  url: string
  title: string
  author: string
  handle: string
  date: string
  quote: string
  /** Self-hosted copy of the post's video poster (served from /videos). */
  thumb: string
  duration: string
}

export const xVideos: XVideoEntry[] = [
  {
    url: 'https://x.com/SolPlay_jonas/status/2059976475877486808',
    title: 'Claude bought me a drink',
    author: 'Jonas Hahn',
    handle: 'SolPlay_jonas',
    date: 'May 28, 2026',
    quote: 'Here the demo of how @claudeai bought me a drink',
    thumb: '/videos/claude-bought-a-drink.jpg',
    duration: '1:24',
  },
]

export const videos: VideoEntry[] = [
  {
    id: 'aLuo-9if0TE',
    title: 'Orquestra 101 - The Open Source API Layer for Solana Programs',
    channel: 'White Moon Dev',
  },
  {
    id: 'SOlGJChz2o0',
    title: '3 Easy Ways to Upload Your Solana Program IDL (AI Ready in Minutes)',
    channel: 'White Moon Dev',
  },
  {
    id: 'z-wTwDII608',
    title: 'This New Orquestra Feature Scans Solana Every Day',
    channel: 'White Moon Dev',
  },
]

export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`
export const youtubeThumbUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
