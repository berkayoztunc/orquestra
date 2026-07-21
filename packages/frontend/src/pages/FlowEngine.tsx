import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/flow-engine.md?raw'

export default function FlowEngine(): JSX.Element {
  return (
    <DocsLayout
      title="Flow Engine"
      description="Publish and run minimal-input, IDL-driven transaction recipes over MCP — no manual account/arg encoding."
      toc={['What is a flow', 'Connect', 'Find and run an existing flow', 'Author a new flow', 'Writing the FDL', 'Reading errors']}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
