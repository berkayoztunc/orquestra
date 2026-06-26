import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import { useIsDark } from '@/lib/useIsDark'

type SupportedLanguage = 'bash' | 'json' | 'python' | 'rust' | 'typescript' | 'text'

interface CodeBlockProps {
  code: string
  language?: SupportedLanguage
  title?: string
  copyable?: boolean
  wrapLongLines?: boolean
  maxHeightClassName?: string
}

SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('typescript', typescript)

export default function CodeBlock({
  code,
  language = 'text',
  title,
  copyable = true,
  wrapLongLines = false,
  maxHeightClassName,
}: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const isDark = useIsDark()

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const containerClassName = [
    'overflow-x-auto border border-border-low bg-sand-50 p-4',
    maxHeightClassName,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="space-y-3">
      {(title || copyable) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title ? <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-sand-1100">{title}</p> : <span />}
          {copyable && (
            <button
              onClick={handleCopy}
              className="flex min-h-9 items-center gap-1.5 border border-border-low bg-sand-100 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sand-1200 transition-colors duration-150 hover:border-border-medium hover:bg-bg1 hover:text-sand-1600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1"
              title="Copy"
              aria-label="Copy code snippet"
            >
              {copied ? (
                <>
                  <CheckIcon className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <CopyIcon className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className={containerClassName}>
        <SyntaxHighlighter
          language={language === 'text' ? undefined : language}
          style={isDark ? oneDark : oneLight}
          wrapLongLines={wrapLongLines}
          customStyle={{
            margin: 0,
            background: 'transparent',
            fontSize: '0.75rem',
            lineHeight: 1.6,
            minWidth: '100%',
          }}
          codeTagProps={{
            style: {
              fontFamily: '"Berkeley Mono", "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}
