import type { Block } from 'payload'
import { validateYouTubeURL, YOUTUBE_URL_HELP } from '../posts/youtube'

export const YouTubeBlock: Block = {
  slug: 'youtube',
  interfaceName: 'YouTubeBlock',
  labels: { singular: 'YouTube video', plural: 'YouTube videos' },
  admin: { components: { Block: '@dvnt/cms/components/YouTubeBlockPreview' } },
  fields: [
    { name: 'url', label: 'YouTube URL', type: 'text', required: true, validate: validateYouTubeURL,
      admin: { description: `${YOUTUBE_URL_HELP} Playback starts only when a reader presses play.` } },
    { name: 'title', label: 'Video title', type: 'text',
      admin: { description: 'Describe the video for readers using screen readers. Defaults to “YouTube video player”.' } },
    { name: 'caption', type: 'text' },
  ],
}
