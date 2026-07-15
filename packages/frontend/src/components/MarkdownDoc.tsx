import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from './CodeBlock'

const SUPPORTED_LANGUAGES = new Set(['bash', 'json', 'python', 'rust', 'typescript'])

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  json: 'JSON',
  python: 'Python',
  rust: 'Rust',
  typescript: 'TypeScript',
  text: 'Output',
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
}

function headingText(children: ReactNode): string {
  return Array.isArray(children) ? children.map((c) => (typeof c === 'string' ? c : '')).join('') : String(children)
}

function CodeRenderer({ className, children }: { className?: string; children?: ReactNode }): JSX.Element {
  const match = /language-(\w+)/.exec(className || '')

  if (!match) {
    return <code>{children}</code>
  }

  const lang = match[1]
  const code = String(children).replace(/\n$/, '')
  const supported = SUPPORTED_LANGUAGES.has(lang) ? (lang as 'bash' | 'json' | 'python' | 'rust' | 'typescript') : 'text'

  return (
    <div className="my-5">
      <CodeBlock code={code} language={supported} title={LANGUAGE_LABELS[supported]} wrapLongLines />
    </div>
  )
}

const markdownComponents = {
  h2: ({ children }: { children?: ReactNode }) => <h2 id={slugify(headingText(children))}>{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 id={slugify(headingText(children))}>{children}</h3>,
  // Fenced code blocks render via components/CodeBlock — header label, copy
  // button, syntax highlighting, proper padding. react-markdown wraps this in
  // its own <pre>, which we unwrap since CodeBlock supplies its own box.
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  code: CodeRenderer,
  // Blockquotes carry the doc pages' safety/warning callouts (audit notice,
  // private-project note) — accent them with the brand's danger-coral token
  // instead of the default neutral border so they still read as warnings.
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-5 border-l-4 border-danger-coral/40 bg-danger-coral/5 pl-4 py-2 text-sand-1500">
      {children}
    </blockquote>
  ),
}

export default function MarkdownDoc({ content }: { content: string }): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  )
}
