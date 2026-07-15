import { DocsLayout } from '@/ui/DocsLayout'
import MarkdownDoc from '../components/MarkdownDoc'
import content from '../content/docs/sign-and-send.md?raw'

export default function SignAndSend(): JSX.Element {
  return (
    <DocsLayout
      title="Sign & Send Transactions"
      description="Build unsigned transactions with Orquestra, then decode, sign, send, and confirm them with your client wallet or backend signer."
      toc={['Flow', 'Build endpoint', 'Language examples', 'Security reminders', 'References']}
    >
      <MarkdownDoc content={content} />
    </DocsLayout>
  )
}
