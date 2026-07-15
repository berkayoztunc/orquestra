import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/api.md?raw'

export default function API(): JSX.Element {
  return (
    <DocsLayout
      title="Public API Reference"
      description="Query program metadata, inspect instruction schemas, derive PDAs, and build unsigned transaction payloads through the Orquestra API."
      toc={['Workflow', 'Base URL', 'Discovery', 'Authentication', 'Endpoints', 'Network parameter', 'Example request']}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
