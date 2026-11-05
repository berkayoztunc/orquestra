import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/lists.md?raw'

export default function ListsDocs(): JSX.Element {
  return (
    <DocsLayout
      title="My Program Lists"
      description="Save a curated set of programs and use a scope key so your AI agent only discovers the programs you chose."
      toc={[
        'What are program lists',
        'Why use them',
        'Create a list',
        'Add programs',
        'Use the scope key with MCP',
        'What a scope key does and does not do',
        'Regenerate or revoke a key',
        'REST API',
        'Troubleshooting',
      ]}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
