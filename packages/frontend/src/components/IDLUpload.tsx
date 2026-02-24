import { useState } from 'react'
import { uploadIDL } from '../api/client'
import { useToast } from '../components/Toast'

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
  const { showToast } = useToast()

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIdlFileName(file.name)

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
      }
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      showToast('Project name is required', 'error')
      return
    }
    if (!programId.trim()) {
      showToast('Program ID is required', 'error')
      return
    }
    if (!idlJson) {
      showToast('Please upload an IDL file', 'error')
      return
    }

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
    <div className="card-static p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Upload Anchor IDL</h2>
          <p className="text-sm text-gray-400">Create a new API from your IDL</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* IDL File */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">IDL File *</label>
          <div className="relative">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
              id="idl-upload"
            />
            <label
              htmlFor="idl-upload"
              className="input flex items-center justify-center cursor-pointer hover:border-primary/50"
            >
              {idlFileName ? (
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-primary">{idlFileName}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-500">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span>Click to select IDL JSON file</span>
                </div>
              )}
            </label>
          </div>
          {idlJson && (
            <p className="text-xs text-primary mt-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Valid IDL: {idlJson.name} v{idlJson.version} ({idlJson.instructions?.length || 0} instructions)
            </p>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Project Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My Token Program"
            className="input w-full"
          />
        </div>

        {/* Program ID */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Program ID (Solana Address) *</label>
          <input
            type="text"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            placeholder="e.g., TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            className="input w-full font-mono text-sm"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the program..."
            rows={2}
            className="input w-full resize-none"
          />
        </div>

        {/* CPI.md (optional) */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">CPI Documentation (optional)</label>
          <textarea
            value={cpiMd}
            onChange={(e) => setCpiMd(e.target.value)}
            placeholder="Paste CPI integration docs here..."
            rows={3}
            className="input w-full resize-none font-mono text-sm"
          />
        </div>

        {/* Visibility */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-surface-elevated border border-white/5">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 rounded-full bg-white/10 peer-checked:bg-primary/30 transition-all peer-checked:border peer-checked:border-primary/50">
              <div className={`w-5 h-5 bg-white rounded-full transform transition-all duration-200 mt-0.5 ${isPublic ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
          </label>
          <div>
            <p className="text-sm text-white font-medium">
              {isPublic ? 'Public Project' : 'Private Project'}
            </p>
            <p className="text-xs text-gray-500">
              {isPublic ? 'Anyone can access the API' : 'Only you can access'}
            </p>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary w-full py-3.5"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Creating Project...
            </span>
          ) : (
            'Upload & Create Project'
          )}
        </button>
      </form>
    </div>
  )
}
