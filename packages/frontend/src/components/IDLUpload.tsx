import { useState } from 'react'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FileJson,
  Loader2,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { uploadIDL } from '../api/client'
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = 'Project name is required'
    if (!programId.trim()) newErrors.programId = 'Program ID is required'
    if (!idlJson) newErrors.idl = 'Please upload an IDL file'
    setFieldErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    setIsLoading(true)
    try {
      const result = await uploadIDL({
        name: name.trim(),
        description: description.trim(),
        programId: programId.trim(),
        idl: idlJson,
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
    <div className="card-static overflow-hidden border border-white/5">
      <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative border-b border-white/5 bg-surface-elevated/55 p-6 lg:border-b-0 lg:border-r">
          <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
              IDL intake
            </div>
            <h2 className="mt-4 text-2xl font-bold text-white">Turn an Anchor IDL into a usable API surface.</h2>
            <p className="mt-3 text-sm leading-6 text-gray-400">
              Upload the program schema, add the on-chain program address, and Orquestra will index the interface for endpoints, docs, transaction builders, and agent tools.
            </p>

            <img
              src={idlGreenprint}
              alt="Green blueprint diagram of an Anchor IDL becoming API surfaces"
              width={960}
              height={720}
              className="mt-6 aspect-[4/3] w-full rounded-2xl border border-primary/20 object-cover shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            />

            <div className="mt-6 space-y-3">
              {uploadBenefits.map((benefit) => (
                <div key={benefit} className="flex gap-3 text-sm leading-6 text-gray-300">
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
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <UploadCloud className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Upload Anchor IDL</h3>
                <p className="text-sm text-gray-400">Required fields are marked with an asterisk.</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" aria-busy={isLoading}>
            <div>
              <label htmlFor="idl-upload" className="block text-sm text-gray-300 mb-2">IDL File *</label>
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
                      <span className="text-xs text-gray-500">Select a different file to replace it.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <UploadCloud className="h-7 w-7 text-primary" aria-hidden="true" />
                      <span className="text-sm font-medium text-gray-300">Select an IDL JSON file</span>
                      <span className="text-xs text-gray-500">Anchor IDL files usually end in .json.</span>
                    </div>
                  )}
                </label>
              </div>
              <p id="idl-upload-help" className="mt-2 text-xs leading-5 text-gray-500">
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

            <div>
              <label htmlFor="project-name" className="block text-sm text-gray-300 mb-2">Project Name *</label>
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
              <p id="project-name-help" className="mt-1.5 text-xs text-gray-500">
                This name appears in your dashboard, generated docs, and API references.
              </p>
              {fieldErrors.name && (
                <p id="project-name-error" className="mt-1.5 text-xs text-red-400">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="program-id" className="block text-sm text-gray-300 mb-2">Program ID (Solana Address) *</label>
              <input
                id="program-id"
                type="text"
                inputMode="text"
                value={programId}
                onChange={(e) => { setProgramId(e.target.value); if (fieldErrors.programId) setFieldErrors(prev => ({ ...prev, programId: '' })) }}
                placeholder="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={fieldErrors.programId ? 'true' : undefined}
                aria-describedby={fieldErrors.programId ? 'program-id-error' : 'program-id-help'}
                className={`input w-full font-mono text-sm ${fieldErrors.programId ? 'border-red-500/50' : ''}`}
              />
              <p id="program-id-help" className="mt-1.5 text-xs text-gray-500">
                Use the deployed program address. This links generated endpoints and PDA helpers to the correct on-chain program.
              </p>
              {fieldErrors.programId && (
                <p id="program-id-error" className="mt-1.5 text-xs text-red-400">{fieldErrors.programId}</p>
              )}
            </div>

            <div>
              <label htmlFor="project-description" className="block text-sm text-gray-300 mb-2">Description</label>
              <textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the program does, who should use it, and any important integration constraints."
                rows={3}
                className="input w-full resize-y"
              />
              <p className="mt-1.5 text-xs text-gray-500">
                A useful description improves generated docs and helps teammates understand when to use this API.
              </p>
            </div>

            <div>
              <label htmlFor="cpi-docs" className="block text-sm text-gray-300 mb-2">CPI Documentation (optional)</label>
              <textarea
                id="cpi-docs"
                value={cpiMd}
                onChange={(e) => setCpiMd(e.target.value)}
                placeholder="Paste CPI integration notes, account relationships, seed rules, or gotchas that are not obvious from the IDL."
                rows={4}
                spellCheck={false}
                className="input w-full resize-y font-mono text-sm"
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Add Markdown for account constraints, seed derivation, signer expectations, or instruction ordering.
              </p>
            </div>

            <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-surface-elevated p-4">
              <label htmlFor="project-visibility" className="relative inline-flex min-h-10 cursor-pointer items-center">
                <input
                  id="project-visibility"
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-white/10 transition-all peer-checked:border peer-checked:border-primary/50 peer-checked:bg-primary/30 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface">
                  <div className={`mt-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200 ${isPublic ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  {isPublic ? <Eye className="h-4 w-4 text-primary" aria-hidden="true" /> : <EyeOff className="h-4 w-4 text-gray-400" aria-hidden="true" />}
                  {isPublic ? 'Public Project' : 'Private Project'}
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  {isPublic ? 'Anyone can discover and call the generated public API.' : 'Only your authenticated account can access this project.'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-5 text-gray-400">
                  Uploading creates the project record, stores the IDL, and starts generation for docs and API metadata. You can edit docs and custom endpoints after the project is created.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary flex min-h-12 w-full items-center justify-center gap-2 py-3.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  Creating Project...
                </>
              ) : (
                'Upload & Create Project'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
