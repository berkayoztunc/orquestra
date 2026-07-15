import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/cli.md?raw'

export default function CLI(): JSX.Element {
  return (
    <DocsLayout
      title="CLI Reference"
      description="Install and operate the Orquestra CLI for local IDL workflows, hosted project API, PDA derivation, and transaction execution."
      toc={['Features', 'Installation', 'Setup', 'Usage examples', 'Command reference']}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
