import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/mcp.md?raw'

export default function MCP(): JSX.Element {
  return (
    <DocsLayout
      title="MCP Server Integration Guide"
      description="Connect Orquestra to MCP-capable assistants so agents can inspect Solana IDLs, derive PDAs, fetch accounts, and build unsigned transactions."
      toc={['Workflow', 'Endpoint', 'Clients', 'Tools', 'Try this prompt', 'Scope Keys']}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
