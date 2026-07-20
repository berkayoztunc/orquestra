/**
 * Derive a raw display name for a program from its on-chain IDL metadata,
 * falling back to the program id when the IDL has no usable name field.
 * Caller is responsible for title-casing (see `toTitleCase` in ai-categorization).
 */
export function deriveIdlProgramName(idl: any, programId: string): string {
  return (
    (typeof idl?.name === 'string' && idl.name) ||
    (typeof idl?.metadata?.name === 'string' && idl.metadata.name) ||
    (typeof idl?.program?.name === 'string' && idl.program.name) ||
    programId
  ).trim() || programId
}
