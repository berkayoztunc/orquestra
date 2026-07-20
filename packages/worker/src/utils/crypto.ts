/** SHA-256 hex digest of an IDL JSON string, used to detect on-chain IDL changes. */
export async function hashIdl(idlJson: string): Promise<string> {
  const bytes = new TextEncoder().encode(idlJson)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
