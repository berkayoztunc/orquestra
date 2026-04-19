const API_ORIGIN = 'https://api.orquestra.dev'
const SITE_ORIGIN = 'https://orquestra.dev'
const DOCUMENT_PATHS = new Set(['/', '/explorer', '/docs/api', '/docs/cli', '/docs/mcp', '/docs/sign-and-send'])
const LINK_HEADER_VALUE = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  `<${API_ORIGIN}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
  '</docs/api>; rel="service-doc"; type="text/html"',
  '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
].join(', ')

function isMarkdownRequest(request) {
  const accept = request.headers.get('Accept') || ''
  return accept.includes('text/markdown')
}

function estimatedTokens(markdown) {
  return String(markdown.trim().split(/\s+/).filter(Boolean).length)
}

function xmlEscape(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function withStandardHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value)
  }
  headers.set('Link', LINK_HEADER_VALUE)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function markdownForPath(pathname) {
  const pages = {
    '/': `# Orquestra\n\nBuild Solana APIs in seconds. Upload your Anchor IDL and get a REST API, AI-ready docs, and an MCP server.\n\n## Key capabilities\n\n- Search public Solana programs\n- Inspect instructions, accounts, and PDA schemas\n- Build unsigned base58 transactions\n- Connect the public MCP endpoint for agent workflows\n\n## Key links\n\n- API docs: ${SITE_ORIGIN}/docs/api\n- API catalog: ${SITE_ORIGIN}/.well-known/api-catalog\n- OpenAPI: ${API_ORIGIN}/openapi.json\n- MCP docs: ${SITE_ORIGIN}/docs/mcp\n- MCP server: ${API_ORIGIN}/mcp\n`,
    '/explorer': `# Explorer\n\nBrowse public programs indexed by Orquestra and inspect the generated API surface for each one.`,
    '/docs/api': `# API Docs\n\nSee the public Orquestra API at ${API_ORIGIN}.\n\n- OpenAPI: ${API_ORIGIN}/openapi.json\n- Health: ${API_ORIGIN}/health\n- API catalog: ${SITE_ORIGIN}/.well-known/api-catalog`,
    '/docs/cli': `# CLI Docs\n\nUse the Orquestra CLI to scan programs and check Anchor IDLs.`,
    '/docs/mcp': `# MCP Docs\n\nConnect to the public MCP endpoint at ${API_ORIGIN}/mcp and use the Orquestra tools for program search, instruction discovery, PDA derivation, and transaction building.`,
    '/docs/sign-and-send': `# Sign and Send\n\nBuild unsigned Solana transactions with Orquestra and submit them with your preferred wallet flow.`,
  }

  return pages[pathname] || `# Orquestra\n\nSee ${SITE_ORIGIN} for the HTML representation of this page.`
}

async function proxyRequest(request, targetUrl) {
  const proxiedRequest = new Request(targetUrl, request)
  return fetch(proxiedRequest)
}

async function handleSitemap(request) {
  const url = new URL(request.url)
  const response = await fetch(`${API_ORIGIN}/api/discovery/sitemap`)
  const data = await response.json()

  const staticEntries = [
    { loc: `${SITE_ORIGIN}/`, lastmod: new Date().toISOString() },
    { loc: `${SITE_ORIGIN}/explorer`, lastmod: new Date().toISOString() },
    { loc: `${SITE_ORIGIN}/docs/api`, lastmod: new Date().toISOString() },
    { loc: `${SITE_ORIGIN}/docs/cli`, lastmod: new Date().toISOString() },
    { loc: `${SITE_ORIGIN}/docs/mcp`, lastmod: new Date().toISOString() },
    { loc: `${SITE_ORIGIN}/docs/sign-and-send`, lastmod: new Date().toISOString() },
  ]

  const dynamicEntries = (data.entries || []).map((entry) => ({
    loc: `${url.origin}/project/${entry.programId}`,
    lastmod: entry.lastmod,
  }))

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticEntries.concat(dynamicEntries).map((entry) => {
      const lines = ['  <url>', `    <loc>${xmlEscape(entry.loc)}</loc>`]
      if (entry.lastmod) {
        lines.push(`    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>`)
      }
      lines.push('  </url>')
      return lines.join('\n')
    }),
    '</urlset>',
  ].join('\n')

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

async function fetchAssetOrSpa(request, env) {
  let response = await env.ASSETS.fetch(request)
  if (response.status !== 404) {
    return response
  }

  const url = new URL(request.url)
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(url.pathname)
  if (hasExtension) {
    return response
  }

  return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return proxyRequest(request, `${API_ORIGIN}${url.pathname}${url.search}`)
    }

    if (url.pathname.startsWith('/auth/')) {
      return proxyRequest(request, `${API_ORIGIN}${url.pathname}${url.search}`)
    }

    if (/^\/project\/[^/]+\/llms\.txt$/.test(url.pathname)) {
      return proxyRequest(request, `${API_ORIGIN}${url.pathname}${url.search}`)
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return proxyRequest(request, `${API_ORIGIN}${url.pathname}${url.search}`)
    }

    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(request)
    }

    if (isMarkdownRequest(request) && (DOCUMENT_PATHS.has(url.pathname) || url.pathname.startsWith('/project/'))) {
      const markdown = markdownForPath(url.pathname)
      return new Response(markdown, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          Vary: 'Accept',
          'x-markdown-tokens': estimatedTokens(markdown),
          'Content-Signal': 'ai-train=yes, search=yes, ai-input=yes',
          Link: LINK_HEADER_VALUE,
        },
      })
    }

    const assetResponse = await fetchAssetOrSpa(request, env)

    if (url.pathname === '/.well-known/api-catalog') {
      return withStandardHeaders(assetResponse, {
        'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"; charset=utf-8',
      })
    }

    if (/^\/\.well-known\/agent-skills\/.+\/SKILL\.md$/.test(url.pathname)) {
      return withStandardHeaders(assetResponse, {
        'Content-Type': 'text/markdown; charset=utf-8',
      })
    }

    if (
      url.pathname === '/.well-known/openid-configuration' ||
      url.pathname === '/.well-known/oauth-authorization-server' ||
      url.pathname === '/.well-known/oauth-protected-resource'
    ) {
      return withStandardHeaders(assetResponse, {
        'Content-Type': 'application/json; charset=utf-8',
      })
    }

    if (url.pathname === '/' || DOCUMENT_PATHS.has(url.pathname)) {
      return withStandardHeaders(assetResponse)
    }

    return assetResponse
  },
}