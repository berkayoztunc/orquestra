export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function isValidSolanaAddress(address: string): boolean {
  // Basic Solana address validation (base58, 32-44 chars)
  const base58Regex = /^[1-9A-HJ-NP-Z]{32,44}$/
  return base58Regex.test(address)
}
