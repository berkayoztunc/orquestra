/**
 * Minimal, non-Turing-complete expression grammar for FDL `in` fields and `if`
 * guards — comparisons, boolean operators, arithmetic, and `$ref` field access.
 * No loops, no function calls, no reflection, no string-to-code path (design
 * doc §6.3, §12.3).
 *
 * A field that is a PURE bare `$ref` (optionally `?`-suffixed) is NOT parsed
 * by this module — the interpreter keeps resolving those exactly as before
 * (raw value passthrough, object/array support, the `?`-optional/array-drop
 * idiom). This module only activates for strings that contain an operator —
 * i.e. actual expressions like `"$quote.outAmount > 0"` or
 * `"$a.count + $b.count"`. That split is what lets `$buildIx.instruction`
 * keep returning a whole FlowInstruction object while `$quote.outAmount > 0`
 * evaluates to a boolean.
 *
 * Grammar (EBNF), precedence low to high:
 *   expr        := or_expr
 *   or_expr     := and_expr ( '||' and_expr )*
 *   and_expr    := equality ( '&&' equality )*
 *   equality    := relational ( ('==' | '!=') relational )*
 *   relational  := additive ( ('>' | '<' | '>=' | '<=') additive )*
 *   additive    := multiplicative ( ('+' | '-') multiplicative )*
 *   multiplicative := unary ( ('*' | '/') unary )*
 *   unary       := ('!' | '-')? primary
 *   primary     := ref | number | string | 'true' | 'false' | 'null' | '(' expr ')'
 *   ref         := '$' ident ('.' ident)*
 */

export type ExprNode =
  | { kind: 'ref'; root: string; path: string[]; raw: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'unary'; op: '!' | '-'; operand: ExprNode }
  | { kind: 'binary'; op: '||' | '&&' | '==' | '!=' | '>' | '<' | '>=' | '<=' | '+' | '-' | '*' | '/'; left: ExprNode; right: ExprNode }

export class ExpressionSyntaxError extends Error {}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'REF' | 'NUMBER' | 'STRING' | 'BOOL' | 'NULL' | 'OP' | 'LPAREN' | 'RPAREN' | 'EOF'
interface Token {
  type: TokenType
  value: string
  pos: number
}

const OPERATORS = ['||', '&&', '==', '!=', '>=', '<=', '>', '<', '+', '-', '*', '/', '!'] as const

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]

    if (/\s/.test(c)) {
      i++
      continue
    }

    if (c === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i })
      i++
      continue
    }

    if (c === '$') {
      const start = i
      i++
      if (!/[A-Za-z_]/.test(src[i] ?? '')) {
        throw new ExpressionSyntaxError(`invalid reference at position ${start}`)
      }
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) i++
      tokens.push({ type: 'REF', value: src.slice(start, i), pos: start })
      continue
    }

    if (/[0-9]/.test(c)) {
      const start = i
      while (i < src.length && /[0-9.]/.test(src[i])) i++
      tokens.push({ type: 'NUMBER', value: src.slice(start, i), pos: start })
      continue
    }

    if (c === '"' || c === "'") {
      const quote = c
      const start = i
      i++
      let value = ''
      while (i < src.length && src[i] !== quote) {
        value += src[i]
        i++
      }
      if (src[i] !== quote) {
        throw new ExpressionSyntaxError(`unterminated string starting at position ${start}`)
      }
      i++
      tokens.push({ type: 'STRING', value, pos: start })
      continue
    }

    if (/[A-Za-z]/.test(c)) {
      const start = i
      while (i < src.length && /[A-Za-z]/.test(src[i])) i++
      const word = src.slice(start, i)
      if (word === 'true' || word === 'false') {
        tokens.push({ type: 'BOOL', value: word, pos: start })
      } else if (word === 'null') {
        tokens.push({ type: 'NULL', value: word, pos: start })
      } else {
        throw new ExpressionSyntaxError(`unexpected identifier "${word}" at position ${start} (did you mean "$${word}"?)`)
      }
      continue
    }

    const twoChar = src.slice(i, i + 2)
    if ((OPERATORS as readonly string[]).includes(twoChar)) {
      tokens.push({ type: 'OP', value: twoChar, pos: i })
      i += 2
      continue
    }
    const oneChar = src[i]
    if ((OPERATORS as readonly string[]).includes(oneChar)) {
      tokens.push({ type: 'OP', value: oneChar, pos: i })
      i++
      continue
    }

    throw new ExpressionSyntaxError(`unexpected character "${c}" at position ${i}`)
  }
  tokens.push({ type: 'EOF', value: '', pos: src.length })
  return tokens
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    return this.tokens[this.pos++]
  }

  private expect(type: TokenType): Token {
    const tok = this.peek()
    if (tok.type !== type) {
      throw new ExpressionSyntaxError(`expected ${type} but got ${tok.type} ("${tok.value}") at position ${tok.pos}`)
    }
    return this.advance()
  }

  parseExpr(): ExprNode {
    const node = this.parseOr()
    this.expect('EOF')
    return node
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd()
    while (this.peek().type === 'OP' && this.peek().value === '||') {
      this.advance()
      left = { kind: 'binary', op: '||', left, right: this.parseAnd() }
    }
    return left
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality()
    while (this.peek().type === 'OP' && this.peek().value === '&&') {
      this.advance()
      left = { kind: 'binary', op: '&&', left, right: this.parseEquality() }
    }
    return left
  }

  private parseEquality(): ExprNode {
    let left = this.parseRelational()
    while (this.peek().type === 'OP' && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.advance().value as '==' | '!='
      left = { kind: 'binary', op, left, right: this.parseRelational() }
    }
    return left
  }

  private parseRelational(): ExprNode {
    let left = this.parseAdditive()
    while (this.peek().type === 'OP' && ['>', '<', '>=', '<='].includes(this.peek().value)) {
      const op = this.advance().value as '>' | '<' | '>=' | '<='
      left = { kind: 'binary', op, left, right: this.parseAdditive() }
    }
    return left
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative()
    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value as '+' | '-'
      left = { kind: 'binary', op, left, right: this.parseMultiplicative() }
    }
    return left
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary()
    while (this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.advance().value as '*' | '/'
      left = { kind: 'binary', op, left, right: this.parseUnary() }
    }
    return left
  }

  private parseUnary(): ExprNode {
    if (this.peek().type === 'OP' && (this.peek().value === '!' || this.peek().value === '-')) {
      const op = this.advance().value as '!' | '-'
      return { kind: 'unary', op, operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek()
    if (tok.type === 'REF') {
      this.advance()
      const parts = tok.value.slice(1).split('.')
      return { kind: 'ref', root: parts[0], path: parts.slice(1), raw: tok.value }
    }
    if (tok.type === 'NUMBER') {
      this.advance()
      return { kind: 'literal', value: Number(tok.value) }
    }
    if (tok.type === 'STRING') {
      this.advance()
      return { kind: 'literal', value: tok.value }
    }
    if (tok.type === 'BOOL') {
      this.advance()
      return { kind: 'literal', value: tok.value === 'true' }
    }
    if (tok.type === 'NULL') {
      this.advance()
      return { kind: 'literal', value: null }
    }
    if (tok.type === 'LPAREN') {
      this.advance()
      const inner = this.parseOr()
      this.expect('RPAREN')
      return inner
    }
    throw new ExpressionSyntaxError(`unexpected token ${tok.type} ("${tok.value}") at position ${tok.pos}`)
  }
}

/** Parse an expression string into an AST. Throws ExpressionSyntaxError on malformed input. */
export function parseExpression(src: string): ExprNode {
  return new Parser(tokenize(src)).parseExpr()
}

/** True if `value` looks like it should be parsed as an expression rather than a literal/bare-ref. */
export function looksLikeExpression(value: unknown): value is string {
  return typeof value === 'string' && value.includes('$') && OPERATORS.some((op) => value.includes(op))
}

/** Collect every `$ref` node found anywhere in an expression AST, for compiler dependency-graph purposes. */
export function collectExprRefs(node: ExprNode): { root: string; path: string[]; raw: string }[] {
  switch (node.kind) {
    case 'ref':
      return [{ root: node.root, path: node.path, raw: node.raw }]
    case 'literal':
      return []
    case 'unary':
      return collectExprRefs(node.operand)
    case 'binary':
      return [...collectExprRefs(node.left), ...collectExprRefs(node.right)]
  }
}

function toNumber(value: unknown, context: string): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  throw new Error(`expression: expected a number for ${context}, got ${JSON.stringify(value)}`)
}

function isTruthy(value: unknown): boolean {
  return Boolean(value)
}

/**
 * Evaluate a parsed expression AST. `resolveRef` resolves a `$ref` (by root +
 * path) against run state — same contract as the interpreter's existing ref
 * resolution, reused rather than duplicated. Throws if a referenced value is
 * undefined (expressions, unlike bare refs, have no `?`-optional form — an
 * unresolvable ref inside an expression is always an error).
 */
export function evaluateExpression(
  node: ExprNode,
  resolveRef: (root: string, path: string[]) => unknown,
): string | number | boolean | null {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'ref': {
      const value = resolveRef(node.root, node.path)
      if (value === undefined) {
        throw new Error(`expression: reference "${node.raw}" resolved to undefined`)
      }
      return value as string | number | boolean | null
    }
    case 'unary': {
      const operand = evaluateExpression(node.operand, resolveRef)
      if (node.op === '!') return !isTruthy(operand)
      return -toNumber(operand, `unary "-" operand`)
    }
    case 'binary': {
      // Short-circuit && / || before evaluating the right side.
      if (node.op === '&&') return isTruthy(evaluateExpression(node.left, resolveRef)) && isTruthy(evaluateExpression(node.right, resolveRef))
      if (node.op === '||') return isTruthy(evaluateExpression(node.left, resolveRef)) || isTruthy(evaluateExpression(node.right, resolveRef))

      const left = evaluateExpression(node.left, resolveRef)
      const right = evaluateExpression(node.right, resolveRef)
      switch (node.op) {
        case '==':
          return left === right
        case '!=':
          return left !== right
        case '>':
          return toNumber(left, 'left side of ">"') > toNumber(right, 'right side of ">"')
        case '<':
          return toNumber(left, 'left side of "<"') < toNumber(right, 'right side of "<"')
        case '>=':
          return toNumber(left, 'left side of ">="') >= toNumber(right, 'right side of ">="')
        case '<=':
          return toNumber(left, 'left side of "<="') <= toNumber(right, 'right side of "<="')
        case '+':
          return toNumber(left, 'left side of "+"') + toNumber(right, 'right side of "+"')
        case '-':
          return toNumber(left, 'left side of "-"') - toNumber(right, 'right side of "-"')
        case '*':
          return toNumber(left, 'left side of "*"') * toNumber(right, 'right side of "*"')
        case '/':
          return toNumber(left, 'left side of "/"') / toNumber(right, 'right side of "/"')
      }
    }
  }
}
