/**
 * Isometric "stack" illustration: Solana at the bottom, the Solana programs on it, Orquestra on top of
 * them, and the AI clients (Claude, Grok, ChatGPT) above that. Drawn with plain SVG polygons so it follows
 * the light/dark theme tokens; labels are skewed onto the slab faces with an isometric transform.
 */

const COS = Math.cos(Math.PI / 6) // 0.866

interface SlabProps {
  cx: number
  cy: number
  w: number
  t: number
  top: string
  left: string
  right: string
  stroke: string
}

function Slab({ cx, cy, w, t, top, left, right, stroke }: SlabProps): JSX.Element {
  const d = w * Math.tan(Math.PI / 6)
  const pts = (...p: Array<[number, number]>) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <g strokeLinejoin="round" strokeWidth="1">
      <polygon points={pts([cx - w, cy], [cx, cy + d], [cx, cy + d + t], [cx - w, cy + t])} fill={left} stroke={stroke} />
      <polygon points={pts([cx, cy + d], [cx + w, cy], [cx + w, cy + t], [cx, cy + d + t])} fill={right} stroke={stroke} />
      <polygon points={pts([cx, cy - d], [cx + w, cy], [cx, cy + d], [cx - w, cy])} fill={top} stroke={stroke} />
    </g>
  )
}

interface FaceTextProps {
  cx: number
  cy: number
  w: number
  /** position on the face in face units, as a fraction of the face edge (−0.5..0.5) */
  u: number
  v: number
  size: number
  fill: string
  weight?: number
  spacing?: number
  opacity?: number
  children: string
}

/** Text lying flat on a slab's top face: baseline runs up-right, like the front edge of the slab. */
function FaceText({ cx, cy, w, u, v, size, fill, weight = 600, spacing = 0.5, opacity = 1, children }: FaceTextProps): JSX.Element {
  const L = w / COS // face edge length
  const x = cx + (u * COS + v * COS) * L
  const y = cy + (-u * 0.5 + v * 0.5) * L
  return (
    <text
      transform={`matrix(${COS} -0.5 ${COS} 0.5 ${x.toFixed(1)} ${y.toFixed(1)})`}
      fontSize={size}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      fontWeight={weight}
      letterSpacing={spacing}
      fill={fill}
      opacity={opacity}
    >
      {children}
    </text>
  )
}

export default function StackIllustration(): JSX.Element {
  const ink = 'rgb(var(--rgb-sand-1600))'
  const inkL = 'rgb(var(--rgb-sand-1400))'
  const inkR = 'rgb(var(--rgb-sand-1500))'
  const paper = 'rgb(var(--rgb-sand-50))'
  const face = 'rgb(var(--rgb-sand-100))'
  const faceL = 'rgb(var(--rgb-sand-200))'
  const faceR = 'rgb(var(--rgb-sand-300))'
  const edge = 'rgb(var(--rgb-sand-800))'
  const muted = 'rgb(var(--rgb-sand-1100))'
  const accent = '#b75000'
  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

  // Layers, bottom to top. `cy` is the centre of each slab's top face.
  const L1 = { cx: 320, cy: 440, w: 176, t: 26 }
  const L2 = { cx: 320, cy: 338, w: 144, t: 20 }
  const L3 = { cx: 320, cy: 240, w: 144, t: 22 }
  const clients = [
    { cx: 186, name: 'Claude', fill: accent, text: paper, left: '#8f3f00', right: '#a04600' },
    { cx: 320, name: 'Grok', fill: ink, text: paper, left: inkL, right: inkR },
    { cx: 454, name: 'ChatGPT', fill: face, text: ink, left: faceL, right: faceR },
  ]
  const topY = 96
  const cubeW = 58

  return (
    <svg
      viewBox="0 0 720 590"
      className="h-auto w-full"
      role="img"
      aria-label="The stack: Solana at the bottom, Solana programs on it, Orquestra on top of them, and AI clients Claude, Grok and ChatGPT above"
    >
      <defs>
        <pattern id="st-dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="rgb(var(--rgb-border-low))" />
        </pattern>
        <radialGradient id="st-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={ink} stopOpacity=".12" />
          <stop offset="1" stopColor={ink} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="720" height="590" fill="url(#st-dots)" opacity=".6" />
      <ellipse cx="220" cy="500" rx="230" ry="64" fill="url(#st-glow)" />

      {/* the stack itself is shifted left so the notes on the right have room to be readable */}
      <g transform="translate(-100 0)">

      {/* 1 · Solana */}
      <Slab {...L1} top={face} left={faceL} right={faceR} stroke={edge} />
      <FaceText cx={L1.cx} cy={L1.cy} w={L1.w} u={-0.4} v={0.16} size={20} fill={ink} weight={800} spacing={2}>SOLANA</FaceText>
      <FaceText cx={L1.cx} cy={L1.cy} w={L1.w} u={-0.4} v={0.31} size={10} fill={muted} opacity={0.9}>accounts · runtime</FaceText>

      {/* 2 · Solana programs */}
      <Slab {...L2} top={face} left={faceL} right={faceR} stroke={edge} />
      <FaceText cx={L2.cx} cy={L2.cy} w={L2.w} u={-0.4} v={0.3} size={12.5} fill={ink} weight={800} spacing={0.8}>SOLANA PROGRAM</FaceText>
      <FaceText cx={L2.cx} cy={L2.cy} w={L2.w} u={-0.4} v={0.46} size={10} fill={muted}>Anchor · Codama</FaceText>

      {/* 3 · Orquestra */}
      <Slab {...L3} top={ink} left={inkL} right={inkR} stroke={edge} />
      <FaceText cx={L3.cx} cy={L3.cy} w={L3.w} u={-0.42} v={0.12} size={18} fill={paper} weight={800} spacing={2}>ORQUESTRA</FaceText>
      <FaceText cx={L3.cx} cy={L3.cy} w={L3.w} u={-0.42} v={0.28} size={10} fill={paper} opacity={0.75}>API · MCP · Flows</FaceText>

      {/* links between the AI clients and Orquestra */}
      {clients.map((c) => (
        <path key={`l-${c.name}`} d={`M${c.cx} ${topY + 54}V${L3.cy - 6}`} stroke={edge} strokeWidth="1.4" strokeDasharray="3 5" opacity=".75" />
      ))}

      {/* 4 · AI clients, floating above */}
      {clients.map((c, i) => (
        <g key={c.name} className="st-float" style={{ ['--i' as string]: i }}>
          <Slab cx={c.cx} cy={topY} w={cubeW} t={16} top={c.fill} left={c.left} right={c.right} stroke={edge} />
          <FaceText cx={c.cx} cy={topY} w={cubeW} u={-0.46} v={0.16} size={c.name.length > 6 ? 10 : 12} fill={c.text} weight={800} spacing={0.6}>{c.name}</FaceText>
        </g>
      ))}

      </g>

      {/* side notes */}
      {[
        { y: topY + 8, x1: 428, t: 'AI clients', s: 'ask in plain English' },
        { y: L3.cy + 4, x1: 378, t: 'The interface', s: 'builds, simulates, never signs' },
        { y: L2.cy + 4, x1: 378, t: 'On-chain logic', s: 'one IDL per program' },
        { y: L1.cy + 2, x1: 410, t: 'The network', s: 'where it all settles' },
      ].map((n) => (
        <g key={n.t}>
          <circle cx={n.x1} cy={n.y} r="2.5" fill={ink} />
          <path d={`M${n.x1 + 4} ${n.y}H462`} stroke={edge} strokeWidth="1" strokeDasharray="2 3" />
          <text x="470" y={n.y - 2} fontSize="14" fontFamily={mono} fontWeight="700" fill={ink}>{n.t}</text>
          <text x="470" y={n.y + 15} fontSize="11.5" fontFamily={mono} fill={muted}>{n.s}</text>
        </g>
      ))}
    </svg>
  )
}
