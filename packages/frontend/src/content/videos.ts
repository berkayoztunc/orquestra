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
