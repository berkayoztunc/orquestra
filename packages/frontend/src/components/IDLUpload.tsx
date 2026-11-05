import { useState } from 'react'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FileJson,
  Loader2,
  AlertTriangle,
  Copy,
  Search,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { checkProgram, uploadIDL, type ProgramCheck } from '../api/client'
import { useToast } from '../components/Toast'
import idlGreenprint from '../assets/idl-greenprint.svg'

interface IDLUploadProps {
  onSuccess: () => void
}

export default function IDLUpload({ onSuccess }: IDLUploadProps): JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [programId, setProgramId] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [idlJson, setIdlJson] = useState<any>(null)
  const [idlFileName, setIdlFileName] = useState('')
  const [cpiMd, setCpiMd] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [check, setCheck] = useState<ProgramCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const { showToast } = useToast()

  const uploadBenefits = [
    'Parse instructions, accounts, errors, events, and argument layouts from the IDL.',
    'Generate REST endpoints, MCP tool metadata, and AI-ready program documentation.',
    'Keep optional CPI notes beside the generated API so integrators get the missing context.',
  ]

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIdlFileName(file.name)
    if (fieldErrors.idl) setFieldErrors((prev) => ({ ...prev, idl: '' }))

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string)
        setIdlJson(json)

        // Auto-fill name from IDL
        if (json.name && !name) {
          setName(json.name)
        }
      } catch {
        showToast('Invalid JSON file. Please upload a valid Anchor IDL.', 'error')
        setIdlJson(null)
        setFieldErrors((prev) => ({ ...prev, idl: 'Upload a valid JSON Anchor IDL file' }))
      }
    }
    reader.readAsText(file)
  }

  const idPlaceholder = programId.trim() || '<PROGRAM_ID>'
  const cmdPmp = `npx @solana-program/program-metadata@latest write idl ${idPlaceholder} ./idl.json`
  const cmdAnchor = `anchor idl init -f target/idl/<program>.json ${idPlaceholder} --provider.cluster mainnet`
  const onChain = check?.status === 'found'
  const noOnChain = check !== null && check.status !== 'found'
  const manualMode = noOnChain && showManual

  const resetCheck = () => {
    setCheck(null)
    setShowManual(false)
    setIdlJson(null)
    setIdlFileName('')
  }

  const handleCheck = async () => {
    const id = programId.trim()
    if (!id) {
      setFieldErrors((prev) => ({ ...prev, programId: 'Program ID is required' }))
      return
    }
    setChecking(true)
    try {
      const result = await checkProgram(id)
      setCheck(result)
      if (result.status === 'found' && result.name && !name) setName(result.name)
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Could not check the program on-chain', 'error')
    } finally {
      setChecking(false)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => showToast('Copied', 'success'),
      () => showToast('Copy failed', 'error'),
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = 'Project name is required'
    if (!programId.trim()) newErrors.programId = 'Program ID is required'
    if (!onChain && !idlJson) newErrors.idl = 'Please upload an IDL file'
    setFieldErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    setIsLoading(true)
    try {
      const result = await uploadIDL({
        name: name.trim(),
        description: description.trim(),
        programId: programId.trim(),
        // On-chain import sends no IDL: the server reads the program's own IDL from the chain.
        idl: onChain ? undefined : idlJson,
        cpiMd: cpiMd.trim() || undefined,
        isPublic,
      })

      showToast(
        `Project "${result.project.name}" created! ${result.idl.instructionCount} instructions found.`,
        'success'
      )
      setTimeout(onSuccess, 1500)
    } catch (err: any) {
      showToast(
        err.response?.data?.error ||
          err.response?.data?.details?.join(', ') ||
          'Failed to upload IDL',
        'error'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="overflow-hidden border border-border-low bg-bg1">
      <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative border-b border-border-low bg-sand-100 p-6 lg:border-b-0 lg:border-r">
          <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
              IDL intake
            </div>
            <h2 className="mt-4 text-2xl font-bold text-sand-1600">Turn an Anchor IDL into a usable API surface.</h2>
            <p className="mt-3 text-sm leading-6 text-sand-1100">
              Upload the program schema, add the on-chain program address, and Orquestra will index the interface for endpoints, docs, transaction builders, and agent tools.
            </p>

            <img
              src={idlGreenprint}
              alt="Green blueprint diagram of an Anchor IDL becoming API surfaces"
              width={960}
              height={720}
              className="mt-6 aspect-[4/3] w-full border border-primary/20 object-cover shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            />

            <div className="mt-6 space-y-3">
              {uploadBenefits.map((benefit) => (
                <div key={benefit} className="flex gap-3 text-sm leading-6 text-sand-1400">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-primary/20 bg-primary/10">
                <UploadCloud className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-sand-1600">Add a program</h3>
                <p className="text-sm text-sand-1100">Start with the program address. On-chain IDLs are imported directly.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" aria-busy={isLoading}>
            <div>
              <label htmlFor="program-id" className="block text-sm text-sand-1400 mb-2">Program ID (Solana Address) *</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="program-id"
                  type="text"
                  inputMode="text"
                  value={programId}
                  onChange={(e) => { setProgramId(e.target.value); resetCheck(); if (fieldErrors.programId) setFieldErrors(prev => ({ ...prev, programId: '' })) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCheck() } }}
                  placeholder="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={fieldErrors.programId ? 'true' : undefined}
                  aria-describedby={fieldErrors.programId ? 'program-id-error' : 'program-id-help'}
                  className={`input w-full font-mono text-sm ${fieldErrors.programId ? 'border-red-500/50' : ''}`}
                />
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checking}
                  className="btn-primary flex min-h-10 flex-shrink-0 items-center justify-center gap-2 px-4 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                  {check ? 'Check again' : 'Check on-chain'}
                </button>
              </div>
              <p id="program-id-help" className="mt-1.5 text-xs text-sand-1100">
                Enter the deployed program address first. Orquestra looks for the program's own on-chain IDL (one lookup) and imports it when it exists.
              </p>
              {fieldErrors.programId && (
                <p id="program-id-error" className="mt-1.5 text-xs text-red-400">{fieldErrors.programId}</p>
              )}
            </div>

            {onChain && (
              <div role="status" className="border border-primary/30 bg-primary/10 p-4 text-sm text-sand-1400">
                <p className="flex items-center gap-2 font-semibold text-primary">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  On-chain IDL found ({check?.source}){typeof check?.instructionCount === 'number' ? ` · ${check.instructionCount} instructions` : ''}
                </p>
                <p className="mt-1 text-xs leading-5 text-sand-1100">
                  This program publishes its own IDL, so it is imported straight from the chain and verified. Manual upload is not available for it.
                </p>
                {check?.alreadyListed && (
                  <p className="mt-2 text-xs text-yellow-300">
                    A project already exists for this program: {check.alreadyListed.name}.
                  </p>
                )}
              </div>
            )}

            {noOnChain && (
              <div role="alert" className="space-y-3 border border-yellow-500/40 bg-yellow-500/5 p-4 text-sm text-sand-1400">
                <p className="flex items-center gap-2 font-semibold text-yellow-300">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {check?.status === 'unreadable' ? 'An on-chain IDL account exists but could not be read.' : 'No on-chain IDL was found for this program.'}
                </p>
                <p className="text-xs leading-5 text-sand-1100">
                  The recommended way is to publish the IDL on-chain (as the program's upgrade authority), then press "Check again". Choose one:
                </p>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-sand-1100">
                    <span>Program Metadata Program (works for Anchor and Codama IDLs)</span>
                    <button type="button" onClick={() => copy(cmdPmp)} className="inline-flex items-center gap-1 hover:text-sand-1600"><Copy className="h-3 w-3" aria-hidden="true" />Copy</button>
                  </div>
                  <pre className="overflow-x-auto border border-border-low bg-sand-100 p-2 font-mono text-xs text-sand-1500">{cmdPmp}</pre>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-sand-1100">
                    <span>Anchor CLI (run in your Anchor project, mainnet-beta)</span>
                    <button type="button" onClick={() => copy(cmdAnchor)} className="inline-flex items-center gap-1 hover:text-sand-1600"><Copy className="h-3 w-3" aria-hidden="true" />Copy</button>
                  </div>
                  <pre className="overflow-x-auto border border-border-low bg-sand-100 p-2 font-mono text-xs text-sand-1500">{cmdAnchor}</pre>
                </div>
                {!showManual && (
                  <p className="text-xs text-sand-1100">
                    Cannot publish on-chain?{' '}
                    <a
                      href="#manual-upload"
                      role="button"
                      onClick={(e) => { e.preventDefault(); setShowManual(true) }}
                      className="font-medium text-yellow-300 underline underline-offset-2 hover:text-yellow-200"
                    >
                      Upload manually instead
                    </a>
                  </p>
                )}
              </div>
            )}

            {manualMode && (
              <div id="manual-upload" role="alert" className="border-2 border-red-500/60 bg-red-500/10 p-4 text-xs leading-5 text-red-200">
                <p className="text-sm font-bold uppercase text-red-300">Manual upload — unverified</p>
                Manually uploaded IDLs are marked unverified, hidden from search and MCP by default, and rejected when the name is too similar to an existing project.
              </div>
            )}

            {manualMode && (
            <div>
              <label htmlFor="idl-upload" className="block text-sm text-sand-1400 mb-2">IDL File *</label>
              <div className="relative">
                <input
                  id="idl-upload"
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="sr-only"
                  aria-invalid={fieldErrors.idl && !idlJson ? 'true' : undefined}
                  aria-describedby="idl-upload-help idl-upload-error"
                />
                <label
                  htmlFor="idl-upload"
                  className={`input flex min-h-[112px] cursor-pointer items-center justify-center border-dashed text-center hover:border-primary/50 focus-within:border-primary/50 ${fieldErrors.idl && !idlJson ? 'border-red-500/50' : ''}`}
                >
                  {idlFileName ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                      <span className="break-all text-sm font-medium text-primary">{idlFileName}</span>
                      <span className="text-xs text-sand-1100">Select a different file to replace it.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-sand-1100">
                      <UploadCloud className="h-7 w-7 text-primary" aria-hidden="true" />
                      <span className="text-sm font-medium text-sand-1400">Select an IDL JSON file</span>
                      <span className="text-xs text-sand-1100">Anchor IDL files usually end in .json.</span>
                    </div>
                  )}
                </label>
              </div>
              <p id="idl-upload-help" className="mt-2 text-xs leading-5 text-sand-1100">
                The IDL is parsed locally first so the form can confirm the program name, version, and instruction count before upload.
              </p>
              {idlJson && (
                <p className="mt-2 flex items-center gap-1 text-xs text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Valid IDL: {idlJson.name || 'Unnamed program'} {idlJson.version ? `v${idlJson.version}` : ''} ({idlJson.instructions?.length || 0} instructions)
                </p>
              )}
              {fieldErrors.idl && !idlJson && (
                <p id="idl-upload-error" className="mt-1.5 text-xs text-red-400">{fieldErrors.idl}</p>
              )}
            </div>
            )}

            {(onChain || manualMode) && (
              <>
            <div>
              <label htmlFor="project-name" className="block text-sm text-sand-1400 mb-2">Project Name *</label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: '' })) }}
                placeholder="My Token Program"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={fieldErrors.name ? 'true' : undefined}
                aria-describedby={fieldErrors.name ? 'project-name-error' : 'project-name-help'}
                className={`input w-full ${fieldErrors.name ? 'border-red-500/50' : ''}`}
              />
              <p id="project-name-help" className="mt-1.5 text-xs text-sand-1100">
                This name appears in your dashboard, generated docs, and API references.
              </p>
              {fieldErrors.name && (
                <p id="project-name-error" className="mt-1.5 text-xs text-red-400">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="project-description" className="block text-sm text-sand-1400 mb-2">Description</label>
              <textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the program does, who should use it, and any important integration constraints."
                rows={3}
                className="input w-full resize-y"
              />
              <p className="mt-1.5 text-xs text-sand-1100">
                A useful description improves generated docs and helps teammates understand when to use this API.
              </p>
            </div>

            {manualMode && (
            <div>
              <label htmlFor="cpi-docs" className="block text-sm text-sand-1400 mb-2">CPI Documentation (optional)</label>
              <textarea
                id="cpi-docs"
                value={cpiMd}
                onChange={(e) => setCpiMd(e.target.value)}
                placeholder="Paste CPI integration notes, account relationships, seed rules, or gotchas that are not obvious from the IDL."
                rows={4}
                spellCheck={false}
                className="input w-full resize-y font-mono text-sm"
              />
              <p className="mt-1.5 text-xs text-sand-1100">
                Add Markdown for account constraints, seed derivation, signer expectations, or instruction ordering.
              </p>
            </div>
            )}

            <div className="flex items-center gap-4 border border-border-low bg-bg1 p-4">
              <label htmlFor="project-visibility" className="relative inline-flex min-h-10 cursor-pointer items-center">
                <input
                  id="project-visibility"
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-sand-100 transition-all peer-checked:border peer-checked:border-primary/50 peer-checked:bg-primary/30 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface">
                  <div className={`mt-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200 ${isPublic ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-sand-1600">
                  {isPublic ? <Eye className="h-4 w-4 text-primary" aria-hidden="true" /> : <EyeOff className="h-4 w-4 text-sand-1100" aria-hidden="true" />}
                  {isPublic ? 'Public Project' : 'Private Project'}
                </p>
                <p className="mt-1 text-xs leading-5 text-sand-1100">
                  {isPublic ? 'Anyone can discover and call the generated public API.' : 'Only your authenticated account can access this project.'}
                </p>
              </div>
            </div>

            <div className=" border border-primary/15 bg-primary/5 p-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-5 text-sand-1100">
                  Uploading creates the project record, stores the IDL, and starts generation for docs and API metadata. You can edit docs and custom endpoints after the project is created.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || checking}
              className="btn-primary flex min-h-12 w-full items-center justify-center gap-2 py-3.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  Creating Project...
                </>
              ) : (
                onChain ? 'Import from chain & create project' : 'Upload manually & create project'
              )}
            </button>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
