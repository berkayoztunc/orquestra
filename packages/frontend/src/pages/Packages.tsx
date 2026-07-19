import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/packages.md?raw'

export default function Packages(): JSX.Element {
  return (
    <DocsLayout
      title="Published Packages"
      description="Companion npm packages for signing Solana transactions: an MCP server and an n8n community node."
      toc={['Signer MCP Server', 'n8n Solana Signer Node']}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
