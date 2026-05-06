import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, Pencil, X, Globe2 } from 'lucide-react'
import type { CustomApiEndpoint, CustomApiEndpointInput, CustomApiEndpointMethod, CustomApiParameter } from '@shared/types'
import {
  addCustomApiEndpoint,
  deleteCustomApiEndpoint,
  listCustomApiEndpoints,
  updateCustomApiEndpoint,
} from '../api/client'
import { useToast } from './Toast'

const METHODS: CustomApiEndpointMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const emptyForm: CustomApiEndpointInput = {
  name: '',
  method: 'GET',
  url: '',
  purpose: '',
  parameters: [],
  exampleRequest: '',
  responseNotes: '',
  authNotes: '',
}

type Props = {
  projectId: string
  isOwner: boolean
}

type FormErrors = Partial<Record<keyof CustomApiEndpointInput | 'parameters', string>>

function toForm(endpoint: CustomApiEndpoint): CustomApiEndpointInput {
  return {
    name: endpoint.name,
    method: endpoint.method,
    url: endpoint.url,
    purpose: endpoint.purpose,
    parameters: endpoint.parameters || [],
    exampleRequest: endpoint.example_request || '',
    responseNotes: endpoint.response_notes || '',
    authNotes: endpoint.auth_notes || '',
  }
}

function normalizeForm(form: CustomApiEndpointInput): CustomApiEndpointInput {
  return {
    name: form.name.trim(),
    method: form.method,
    url: form.url.trim(),
    purpose: form.purpose.trim(),
    parameters: (form.parameters || [])
      .map((param) => ({
        name: param.name.trim(),
        description: param.description.trim(),
        required: Boolean(param.required),
      }))
      .filter((param) => param.name || param.description),
    exampleRequest: form.exampleRequest?.trim(),
    responseNotes: form.responseNotes?.trim(),
    authNotes: form.authNotes?.trim(),
  }
}

function isAllowedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  } catch {
    return false
  }
}

function validateForm(form: CustomApiEndpointInput): FormErrors {
  const errors: FormErrors = {}
  if (!form.name.trim()) errors.name = 'Name is required.'
  if (!form.url.trim()) errors.url = 'URL is required.'
  else if (!isAllowedUrl(form.url.trim())) errors.url = 'Use https://, or local http://localhost / 127.0.0.1.'
  if (!form.purpose.trim()) errors.purpose = 'Purpose is required.'
  const badParam = (form.parameters || []).find((param) => (param.name.trim() && !param.description.trim()) || (!param.name.trim() && param.description.trim()))
  if (badParam) errors.parameters = 'Each parameter needs both a name and description.'
  return errors
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return <p id={id} className="text-xs text-red-400 mt-1.5">{message}</p>
}

export default function ExternalApisPanel({ projectId, isOwner }: Props): JSX.Element {
  const { showToast } = useToast()
  const [endpoints, setEndpoints] = useState<CustomApiEndpoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CustomApiEndpointInput>(emptyForm)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CustomApiEndpoint | null>(null)

  const isEditing = useMemo(() => Boolean(editingId), [editingId])

  const loadEndpoints = async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = await listCustomApiEndpoints(projectId)
      setEndpoints(data || [])
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load external APIs.')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadEndpoints()
  }, [projectId])

  const resetForm = () => {
    setForm(emptyForm)
    setFormErrors({})
    setEditingId(null)
    setIsFormOpen(false)
  }

  const startEdit = (endpoint: CustomApiEndpoint) => {
    setForm(toForm(endpoint))
    setFormErrors({})
    setEditingId(endpoint.id)
    setIsFormOpen(true)
  }

  const addParameter = () => {
    setForm((prev) => ({
      ...prev,
      parameters: [...(prev.parameters || []), { name: '', description: '', required: false }],
    }))
  }

  const updateParameter = (index: number, patch: Partial<CustomApiParameter>) => {
    setForm((prev) => ({
      ...prev,
      parameters: (prev.parameters || []).map((param, idx) => idx === index ? { ...param, ...patch } : param),
    }))
  }

  const removeParameter = (index: number) => {
    setForm((prev) => ({
      ...prev,
      parameters: (prev.parameters || []).filter((_, idx) => idx !== index),
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const errors = validateForm(form)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setIsSaving(true)
    try {
      const payload = normalizeForm(form)
      if (editingId) {
        await updateCustomApiEndpoint(projectId, editingId, payload)
        showToast('External API updated', 'success')
      } else {
        await addCustomApiEndpoint(projectId, payload)
        showToast('External API added', 'success')
      }
      resetForm()
      await loadEndpoints()
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save external API', 'error')
    }
    setIsSaving(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteCustomApiEndpoint(projectId, deleteTarget.id)
      setEndpoints((prev) => prev.filter((endpoint) => endpoint.id !== deleteTarget.id))
      setDeleteTarget(null)
      showToast('External API deleted', 'info')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete external API', 'error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 flex-shrink-0">
            <Globe2 className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">External APIs</h3>
            <p className="text-sm text-gray-400 max-w-2xl">
              Document third-party indexer or account-data endpoints for AI systems. Orquestra stores these notes and publishes them in llms.txt; it does not call these APIs.
            </p>
          </div>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => {
              if (isFormOpen) resetForm()
              else setIsFormOpen(true)
            }}
            className="btn-primary min-h-10 text-sm px-4 py-2 inline-flex items-center justify-center gap-2 self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            {isFormOpen ? <X className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            {isFormOpen ? 'Cancel' : 'Add External API'}
          </button>
        )}
      </div>

      {isFormOpen && isOwner && (
        <form onSubmit={handleSubmit} className="card-static p-5 space-y-5" aria-busy={isSaving}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="external-api-name" className="block text-sm text-gray-400 mb-2">Name *</label>
              <input
                id="external-api-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Indexer account lookup"
                className="input w-full"
                maxLength={120}
                autoComplete="off"
                aria-invalid={formErrors.name ? 'true' : undefined}
                aria-describedby={formErrors.name ? 'external-api-name-error' : undefined}
              />
              <FieldError id="external-api-name-error" message={formErrors.name} />
            </div>
            <div>
              <label htmlFor="external-api-method" className="block text-sm text-gray-400 mb-2">Method *</label>
              <select
                id="external-api-method"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as CustomApiEndpointMethod })}
                className="input w-full"
              >
                {METHODS.map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="external-api-url" className="block text-sm text-gray-400 mb-2">URL *</label>
            <input
              id="external-api-url"
              type="url"
              inputMode="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://api.example.com/v1/accounts/{address}"
              className="input w-full font-mono text-sm"
              maxLength={2048}
              autoComplete="url"
              spellCheck={false}
              aria-invalid={formErrors.url ? 'true' : undefined}
              aria-describedby={formErrors.url ? 'external-api-url-error external-api-url-hint' : 'external-api-url-hint'}
            />
            <p id="external-api-url-hint" className="text-xs text-gray-500 mt-1.5">Use placeholders like {'{address}'} for path or query values.</p>
            <FieldError id="external-api-url-error" message={formErrors.url} />
          </div>

          <div>
            <label htmlFor="external-api-purpose" className="block text-sm text-gray-400 mb-2">Purpose *</label>
            <textarea
              id="external-api-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="Explains which account or indexer data this endpoint returns."
              className="input w-full min-h-[96px] resize-y"
              maxLength={1000}
              aria-invalid={formErrors.purpose ? 'true' : undefined}
              aria-describedby={formErrors.purpose ? 'external-api-purpose-error' : undefined}
            />
            <FieldError id="external-api-purpose-error" message={formErrors.purpose} />
          </div>

          <fieldset className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-sm text-gray-400">Parameters</legend>
              <button
                type="button"
                onClick={addParameter}
                className="btn-secondary min-h-10 text-sm px-3 py-2 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Parameter
              </button>
            </div>
            <FieldError id="external-api-parameters-error" message={formErrors.parameters} />
            {(form.parameters || []).map((param, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto] gap-3 bg-surface-elevated p-3 rounded-xl">
                <input
                  type="text"
                  value={param.name}
                  onChange={(e) => updateParameter(index, { name: e.target.value })}
                  placeholder="address"
                  className="input w-full"
                  maxLength={120}
                  autoComplete="off"
                  aria-label={`Parameter ${index + 1} name`}
                />
                <input
                  type="text"
                  value={param.description}
                  onChange={(e) => updateParameter(index, { description: e.target.value })}
                  placeholder="Account public key to fetch"
                  className="input w-full"
                  maxLength={1000}
                  aria-label={`Parameter ${index + 1} description`}
                />
                <label className="min-h-10 flex items-center gap-2 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={Boolean(param.required)}
                    onChange={(e) => updateParameter(index, { required: e.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-surface"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => removeParameter(index)}
                  className="min-h-10 px-3 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
                  aria-label={`Remove parameter ${index + 1}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="external-api-auth" className="block text-sm text-gray-400 mb-2">Auth Notes</label>
              <input
                id="external-api-auth"
                type="text"
                value={form.authNotes}
                onChange={(e) => setForm({ ...form, authNotes: e.target.value })}
                placeholder="Bearer <API_KEY>"
                className="input w-full"
                maxLength={1000}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-gray-500 mt-1.5">Use placeholders only. Real secrets are rejected by the API.</p>
            </div>
            <div>
              <label htmlFor="external-api-response" className="block text-sm text-gray-400 mb-2">Response Notes</label>
              <textarea
                id="external-api-response"
                value={form.responseNotes}
                onChange={(e) => setForm({ ...form, responseNotes: e.target.value })}
                placeholder="Describe important fields and account mapping."
                className="input w-full min-h-[92px] resize-y"
                maxLength={5000}
              />
            </div>
          </div>

          <div>
            <label htmlFor="external-api-example" className="block text-sm text-gray-400 mb-2">Example Request</label>
            <textarea
              id="external-api-example"
              value={form.exampleRequest}
              onChange={(e) => setForm({ ...form, exampleRequest: e.target.value })}
              placeholder={'curl "https://api.example.com/v1/accounts/{address}" \\\n  -H "Authorization: Bearer <API_KEY>"'}
              className="input w-full min-h-[120px] font-mono text-sm resize-y"
              maxLength={5000}
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col sm:flex-row justify-end gap-3">
            <button type="button" onClick={resetForm} className="btn-secondary min-h-10 px-4 py-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary min-h-10 px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add External API'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="grid gap-3">
          {[0, 1].map((item) => (
            <div key={item} className="card-static p-5 animate-pulse">
              <div className="h-4 w-48 bg-white/10 rounded mb-4" />
              <div className="h-3 w-full bg-white/5 rounded mb-2" />
              <div className="h-3 w-2/3 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card-static p-6 text-center">
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <button type="button" onClick={loadEndpoints} className="btn-secondary min-h-10 px-4 py-2">
            Retry
          </button>
        </div>
      ) : endpoints.length === 0 ? (
        <div className="card-static p-8 text-center">
          <p className="text-gray-400">No external APIs documented yet</p>
          {isOwner && <p className="text-sm text-gray-500 mt-2">Add indexer or account-data endpoints to include them in llms.txt.</p>}
        </div>
      ) : (
        <div className="grid gap-4">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="card-static p-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="badge bg-secondary/15 text-secondary border border-secondary/20 text-xs">{endpoint.method}</span>
                    <h4 className="font-semibold text-white">{endpoint.name}</h4>
                  </div>
                  <code className="text-xs font-mono text-primary break-all block">{endpoint.url}</code>
                  <p className="text-sm text-gray-400 mt-3">{endpoint.purpose}</p>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-2 self-start">
                    <button
                      type="button"
                      onClick={() => startEdit(endpoint)}
                      className="min-h-10 px-3 py-2 rounded-lg text-gray-300 hover:text-primary hover:bg-primary/10 transition inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                      aria-label={`Edit ${endpoint.name}`}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(endpoint)}
                      className="min-h-10 px-3 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
                      aria-label={`Delete ${endpoint.name}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              {endpoint.auth_notes && (
                <p className="text-xs text-gray-500 mt-3">Auth: <span className="text-gray-300">{endpoint.auth_notes}</span></p>
              )}

              {endpoint.parameters.length > 0 && (
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-white/5">
                        <th className="text-left py-2 pr-4 font-medium">Parameter</th>
                        <th className="text-left py-2 pr-4 font-medium">Required</th>
                        <th className="text-left py-2 pr-4 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoint.parameters.map((param) => (
                        <tr key={param.name} className="border-b border-white/5 last:border-0">
                          <td className="py-2.5 pr-4 font-mono text-gray-300">{param.name}</td>
                          <td className="py-2.5 pr-4 text-gray-400">{param.required ? 'Yes' : 'No'}</td>
                          <td className="py-2.5 pr-4 text-gray-400">{param.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(endpoint.example_request || endpoint.response_notes) && (
                <div className="grid gap-3 mt-4">
                  {endpoint.example_request && (
                    <pre className="whitespace-pre-wrap text-xs text-gray-300 font-mono leading-relaxed overflow-x-auto p-3 bg-surface-elevated rounded-xl">
                      {endpoint.example_request}
                    </pre>
                  )}
                  {endpoint.response_notes && (
                    <p className="text-sm text-gray-400 whitespace-pre-wrap">{endpoint.response_notes}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card-static p-6 max-w-md w-full border border-red-500/20">
            <h3 className="text-lg font-bold text-white mb-3">Delete External API</h3>
            <p className="text-gray-400 text-sm mb-5">
              Remove <strong className="text-white">{deleteTarget.name}</strong> from this project and llms.txt?
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary min-h-10 px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="bg-red-500/10 border border-red-500/30 text-red-400 min-h-10 px-4 py-2 rounded-xl hover:bg-red-500/20 transition text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
