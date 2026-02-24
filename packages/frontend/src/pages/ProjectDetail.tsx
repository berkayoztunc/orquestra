import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useProjectsStore } from '../store/projects'
import { useAuthStore } from '../store/auth'
import { useToast } from '../components/Toast'
import {
  listInstructions,
  getAccounts,
  getErrors,
  getEvents,
  getDocs,
  listAPIKeys,
  createAPIKey,
  deleteAPIKey,
  updateProject,
  updateDocs,
  resetDocs,
  listKnownAddresses,
  addKnownAddress,
  deleteKnownAddress,
  deleteProject,
  listPdaAccounts,
} from '../api/client'
import InstructionExplorer from '../components/InstructionExplorer'
import PDAExplorer from '../components/PDAExplorer'

type Tab = 'instructions' | 'accounts' | 'errors' | 'events' | 'pda' | 'docs' | 'addresses' | 'settings'

export default function ProjectDetail(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>()
  const { selectedProject, loadProject, isLoading } = useProjectsStore()
  const { user } = useAuthStore()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = useState<Tab>('instructions')
  const [instructions, setInstructions] = useState<any>(null)
  const [accounts, setAccounts] = useState<any>(null)
  const [errors, setErrors] = useState<any>(null)
  const [events, setEvents] = useState<any>(null)
  const [docs, setDocs] = useState<string>('')
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [pdaData, setPdaData] = useState<any>(null)
  const [tabLoading, setTabLoading] = useState(false)

  // Docs editing state
  const [isEditingDocs, setIsEditingDocs] = useState(false)
  const [editedDocs, setEditedDocs] = useState('')
  const [isCustomDocs, setIsCustomDocs] = useState(false)

  // Known addresses state
  const [knownAddresses, setKnownAddresses] = useState<any[]>([])
  const [newAddress, setNewAddress] = useState({ label: '', address: '', description: '' })
  const [showAddAddress, setShowAddAddress] = useState(false)

  // Socials editing state
  const [socialsForm, setSocialsForm] = useState<Record<string, string>>({})
  const [isSavingSocials, setIsSavingSocials] = useState(false)

  // Delete confirmation state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')

  // Custom confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean
    title: string
    message: string
    onConfirm: () => void
    confirmText?: string
  } | null>(null)

  const navigate = useNavigate()

  useEffect(() => {
    if (projectId) {
      loadProject(projectId)
    }
  }, [projectId, loadProject])

  useEffect(() => {
    if (!projectId) return
    setTabLoading(true)

    const loadTabData = async () => {
      try {
        switch (activeTab) {
          case 'instructions':
            if (!instructions) {
              const data = await listInstructions(projectId)
              setInstructions(data)
            }
            break
          case 'accounts':
            if (!accounts) {
              const data = await getAccounts(projectId)
              setAccounts(data)
            }
            break
          case 'errors':
            if (!errors) {
              const data = await getErrors(projectId)
              setErrors(data)
            }
            break
          case 'events':
            if (!events) {
              const data = await getEvents(projectId)
              setEvents(data)
            }
            break
          case 'docs':
            if (!docs) {
              const data = await getDocs(projectId, 'json')
              const docsText = typeof data === 'string' ? data : data.docs || ''
              setDocs(docsText)
              setIsCustomDocs(data.isCustom || false)
            }
            break
          case 'addresses':
            const addrData = await listKnownAddresses(projectId)
            setKnownAddresses(addrData)
            break
          case 'pda':
            if (!pdaData) {
              const data = await listPdaAccounts(projectId)
              setPdaData(data)
            }
            break
          case 'settings':
            if (selectedProject?.isOwner) {
              const keys = await listAPIKeys(projectId)
              setApiKeys(keys)
              // Initialize socials form with current values
              setSocialsForm({
                twitter: selectedProject.socials?.twitter || '',
                discord: selectedProject.socials?.discord || '',
                telegram: selectedProject.socials?.telegram || '',
                github: selectedProject.socials?.github || '',
                website: selectedProject.socials?.website || '',
              })
            }
            break
        }
      } catch (err) {
        console.error('Failed to load tab data:', err)
      }
      setTabLoading(false)
    }

    loadTabData()
  }, [activeTab, projectId, selectedProject])

  if (isLoading || !selectedProject) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'instructions', label: 'Instructions' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'errors', label: 'Errors' },
    { id: 'events', label: 'Events' },
    { id: 'pda', label: 'PDA Finder' },
    { id: 'docs', label: 'Docs' },
    { id: 'addresses', label: 'Addresses' },
    ...(selectedProject.isOwner ? [{ id: 'settings' as Tab, label: 'Settings' }] : []),
  ]

  const handleGenerateKey = async () => {
    if (!projectId) return
    try {
      const result = await createAPIKey(projectId)
      setNewKey(result.key)
      const keys = await listAPIKeys(projectId)
      setApiKeys(keys)
      showToast('API key generated successfully', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to create API key', 'error')
    }
  }

  const handleDeleteKey = async (keyId: string) => {
    if (!projectId) return
    if (!confirm('Delete this API key?')) return
    try {
      await deleteAPIKey(projectId, keyId)
      setApiKeys(apiKeys.filter((k) => k.id !== keyId))
      showToast('API key deleted', 'info')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete API key', 'error')
    }
  }

  const handleToggleVisibility = async () => {
    if (!projectId) return
    try {
      await updateProject(projectId, { isPublic: !selectedProject.is_public })
      loadProject(projectId)
      showToast(`Project is now ${!selectedProject.is_public ? 'public' : 'private'}`, 'success')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update project', 'error')
    }
  }

  // ── Docs editing handlers ──
  const handleEditDocs = () => {
    setEditedDocs(docs)
    setIsEditingDocs(true)
  }

  const handleSaveDocs = async () => {
    if (!projectId) return
    try {
      await updateDocs(projectId, editedDocs)
      setDocs(editedDocs)
      setIsCustomDocs(true)
      setIsEditingDocs(false)
      showToast('Documentation saved', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save docs', 'error')
    }
  }

  const handleResetDocs = async () => {
    if (!projectId) return
    if (!confirm('Reset documentation to auto-generated? Your custom edits will be lost.')) return
    try {
      await resetDocs(projectId)
      setDocs('')
      setIsCustomDocs(false)
      setIsEditingDocs(false)
      // Refetch auto-generated docs
      const data = await getDocs(projectId, 'json')
      setDocs(typeof data === 'string' ? data : data.docs || '')
      setIsCustomDocs(data.isCustom || false)
      showToast('Documentation reset to auto-generated', 'info')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to reset docs', 'error')
    }
  }

  // ── Known addresses handlers ──
  const handleAddAddress = async () => {
    if (!projectId) return
    try {
      await addKnownAddress(projectId, newAddress)
      setNewAddress({ label: '', address: '', description: '' })
      setShowAddAddress(false)
      const addrData = await listKnownAddresses(projectId)
      setKnownAddresses(addrData)
      showToast('Address added successfully', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to add address', 'error')
    }
  }

  const handleDeleteAddress = async (addressId: string) => {
    if (!projectId) return
    if (!confirm('Delete this known address?')) return
    try {
      await deleteKnownAddress(projectId, addressId)
      setKnownAddresses(knownAddresses.filter((a) => a.id !== addressId))
      showToast('Address deleted', 'info')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete address', 'error')
    }
  }

  // ── Socials handler ──
  const handleSaveSocials = async () => {
    if (!projectId) return
    setIsSavingSocials(true)
    try {
      await updateProject(projectId, { socials: socialsForm })
      await loadProject(projectId)
      showToast('Social links updated', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update social links', 'error')
    }
    setIsSavingSocials(false)
  }

  // ── Delete project handler ──
  const handleDeleteProject = async () => {
    if (!projectId) return
    setDeleteError('')
    try {
      await deleteProject(projectId, deleteConfirmName)
      setShowDeleteModal(false)
      showToast('Project deleted successfully', 'success')
      navigate('/dashboard')
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || 'Failed to delete project')
    }
  }

  return (
    <div className="space-y-8">
      {/* Project Header - Modern */}
      <div className="card-static p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                <span className="text-primary font-bold text-lg">
                  {selectedProject.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold text-white">{selectedProject.name}</h1>
                  <span
                    className={`badge ${
                      selectedProject.is_public
                        ? 'badge-primary'
                        : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20'
                    }`}
                  >
                    {selectedProject.is_public ? 'Public' : 'Private'}
                  </span>
                </div>
                {selectedProject.username && (
                  <p className="text-sm text-gray-500 mt-1">
                    by {selectedProject.username}
                  </p>
                )}
              </div>
            </div>
            {selectedProject.description && (
              <p className="text-gray-400 mb-4 max-w-2xl">{selectedProject.description}</p>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Program:</span>
              <code className="text-primary font-mono text-xs bg-primary/10 px-2 py-1 rounded">
                {selectedProject.program_id}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(selectedProject.program_id)
                  showToast('Copied to clipboard', 'success')
                }}
                className="text-gray-500 hover:text-primary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>

            {/* Social Links Display */}
            {selectedProject.socials && Object.values(selectedProject.socials).some(v => v) && (
              <div className="flex items-center gap-3 mt-4 flex-wrap">
                {selectedProject.socials.twitter && (
                  <a
                    href={selectedProject.socials.twitter.startsWith('http') ? selectedProject.socials.twitter : `https://twitter.com/${selectedProject.socials.twitter.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors bg-white/5 px-2.5 py-1.5 rounded-lg"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span>Twitter</span>
                  </a>
                )}
                {selectedProject.socials.discord && (
                  <a
                    href={selectedProject.socials.discord.startsWith('http') ? selectedProject.socials.discord : `https://discord.gg/${selectedProject.socials.discord}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#5865F2] transition-colors bg-white/5 px-2.5 py-1.5 rounded-lg"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z" />
                    </svg>
                    <span>Discord</span>
                  </a>
                )}
                {selectedProject.socials.telegram && (
                  <a
                    href={selectedProject.socials.telegram.startsWith('http') ? selectedProject.socials.telegram : `https://t.me/${selectedProject.socials.telegram.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#26A5E4] transition-colors bg-white/5 px-2.5 py-1.5 rounded-lg"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                    <span>Telegram</span>
                  </a>
                )}
                {selectedProject.socials.github && (
                  <a
                    href={selectedProject.socials.github.startsWith('http') ? selectedProject.socials.github : `https://github.com/${selectedProject.socials.github}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors bg-white/5 px-2.5 py-1.5 rounded-lg"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                    </svg>
                    <span>GitHub</span>
                  </a>
                )}
                {selectedProject.socials.website && (
                  <a
                    href={selectedProject.socials.website.startsWith('http') ? selectedProject.socials.website : `https://${selectedProject.socials.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors bg-white/5 px-2.5 py-1.5 rounded-lg"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <span>Website</span>
                  </a>
                )}
              </div>
            )}
          </div>
          {selectedProject.avatar_url && (
            <img
              src={selectedProject.avatar_url}
              alt={selectedProject.username || ''}
              className="w-10 h-10 rounded-lg border border-white/10"
            />
          )}
        </div>
      </div>

      {/* Tabs - Modern */}
      <div className="flex gap-1 border-b border-white/5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {tabLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
        ) : (
          <>
            {/* Instructions Tab */}
            {activeTab === 'instructions' && instructions && (
              <InstructionExplorer
                projectId={projectId!}
                instructions={instructions.instructions || []}
                programId={instructions.programId}
              />
            )}

            {/* Accounts Tab */}
            {activeTab === 'accounts' && accounts && (
              <div className="grid gap-4">
                {(accounts.accounts || []).length === 0 ? (
                  <div className="card-static p-8 text-center">
                    <p className="text-gray-400">No account types defined</p>
                  </div>
                ) : (
                  (accounts.accounts || []).map((acc: any) => (
                    <div key={acc.name} className="card-static p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-bold text-white">{acc.name}</h3>
                        <span className="badge bg-secondary/15 text-secondary border border-secondary/20 text-xs">
                          {acc.kind}
                        </span>
                      </div>
                      {acc.fields?.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-gray-500 border-b border-white/5">
                                <th className="text-left py-2 pr-4 font-medium">Field</th>
                                <th className="text-left py-2 pr-4 font-medium">Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {acc.fields.map((f: any) => (
                                <tr key={f.name} className="border-b border-white/5 last:border-0">
                                  <td className="py-2.5 pr-4 font-mono text-gray-300">{f.name}</td>
                                  <td className="py-2.5 pr-4 text-secondary">{f.type}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Errors Tab */}
            {activeTab === 'errors' && errors && (
              <div className="card-static overflow-hidden">
                {(errors.errors || []).length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-gray-400">No custom errors defined</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-white/5 bg-white/[0.02]">
                        <th className="text-left py-3 px-4 font-medium">Code</th>
                        <th className="text-left py-3 px-4 font-medium">Name</th>
                        <th className="text-left py-3 px-4 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(errors.errors || []).map((err: any) => (
                        <tr key={err.code} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                          <td className="py-3 px-4 text-primary font-mono">{err.code}</td>
                          <td className="py-3 px-4 font-mono text-gray-300">{err.name}</td>
                          <td className="py-3 px-4 text-gray-400">{err.msg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Events Tab */}
            {activeTab === 'events' && events && (
              <div className="grid gap-4">
                {(events.events || []).length === 0 ? (
                  <div className="card-static p-8 text-center">
                    <p className="text-gray-400">No events defined</p>
                  </div>
                ) : (
                  (events.events || []).map((evt: any) => (
                    <div key={evt.name} className="card-static p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-bold text-white">{evt.name}</h3>
                      </div>
                      {Array.isArray(evt.fields) && evt.fields.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-gray-500 border-b border-white/5">
                                <th className="text-left py-2 pr-4 font-medium">Field</th>
                                <th className="text-left py-2 pr-4 font-medium">Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {evt.fields.map((f: any) => (
                                <tr key={f.name} className="border-b border-white/5 last:border-0">
                                  <td className="py-2.5 pr-4 font-mono text-gray-300">{f.name}</td>
                                  <td className="py-2.5 pr-4 text-secondary">{f.type}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Docs Tab */}
            {activeTab === 'docs' && (
              <div className="card-static p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">
                        {isCustomDocs ? 'Custom Documentation' : 'Generated Documentation'}
                      </h3>
                      {isCustomDocs && (
                        <span className="text-xs text-blue-400">Edited</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedProject.isOwner && !isEditingDocs && (
                      <button
                        onClick={handleEditDocs}
                        className="btn-secondary text-sm px-4 py-2"
                      >
                        Edit
                      </button>
                    )}
                    {selectedProject.isOwner && isCustomDocs && !isEditingDocs && (
                      <button
                        onClick={handleResetDocs}
                        className="text-sm text-yellow-400 hover:text-yellow-300 transition px-3 py-2"
                      >
                        Reset
                      </button>
                    )}
                    {!isEditingDocs && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(docs)
                          showToast('Copied to clipboard', 'success')
                        }}
                        className="btn-secondary text-sm px-4 py-2"
                      >
                        Copy
                      </button>
                    )}
                    {!isEditingDocs && selectedProject.is_public && (
                      <a
                        href={`https://api.orquestra.dev/project/${projectId}/llms.txt`}
                        className="btn-secondary text-sm px-4 py-2"
                      >
                        LLMs
                      </a>
                    )}
                  </div>
                </div>
                {isEditingDocs ? (
                  <div>
                    <textarea
                      value={editedDocs}
                      onChange={(e) => setEditedDocs(e.target.value)}
                      className="input w-full h-[500px] font-mono text-sm leading-relaxed resize-y"
                      placeholder="Write your documentation in Markdown..."
                    />
                    <div className="flex justify-end gap-3 mt-4">
                      <button
                        onClick={() => setIsEditingDocs(false)}
                        className="btn-secondary px-4 py-2"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveDocs}
                        className="btn-primary px-4 py-2"
                      >
                        Save Documentation
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-gray-300 font-mono leading-relaxed max-h-[600px] overflow-y-auto p-4 bg-surface-elevated rounded-xl">
                    {docs || 'Loading...'}
                  </pre>
                )}
              </div>
            )}

            {/* Addresses Tab */}
            {activeTab === 'addresses' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-white">Known Addresses</h3>
                  </div>
                  {selectedProject.isOwner && (
                    <button
                      onClick={() => setShowAddAddress(!showAddAddress)}
                      className="btn-primary text-sm px-4 py-2"
                    >
                      {showAddAddress ? 'Cancel' : 'Add'}
                    </button>
                  )}
                </div>

                {showAddAddress && selectedProject.isOwner && (
                  <div className="card-static p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">Label *</label>
                        <input
                          type="text"
                          value={newAddress.label}
                          onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })}
                          placeholder="e.g., Program Authority"
                          className="input w-full"
                          maxLength={100}
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">Public Key *</label>
                        <input
                          type="text"
                          value={newAddress.address}
                          onChange={(e) => setNewAddress({ ...newAddress, address: e.target.value })}
                          placeholder="e.g., 11111111111111111111111111111111"
                          className="input w-full font-mono text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Description</label>
                      <input
                        type="text"
                        value={newAddress.description}
                        onChange={(e) => setNewAddress({ ...newAddress, description: e.target.value })}
                        placeholder="Optional description"
                        className="input w-full"
                      />
                    </div>
                    <button
                      onClick={handleAddAddress}
                      disabled={!newAddress.label || !newAddress.address}
                      className="btn-primary w-full md:w-auto"
                    >
                      Add Address
                    </button>
                  </div>
                )}

                {knownAddresses.length === 0 ? (
                  <div className="card-static p-8 text-center">
                    <p className="text-gray-400">No known addresses added yet</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {knownAddresses.map((addr: any) => (
                      <div
                        key={addr.id}
                        className="card-static p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-white">{addr.label}</span>
                          </div>
                          <code className="text-xs font-mono text-primary break-all block">{addr.address}</code>
                          {addr.description && (
                            <p className="text-sm text-gray-500 mt-1">{addr.description}</p>
                          )}
                        </div>
                        {selectedProject.isOwner && (
                          <button
                            onClick={() => handleDeleteAddress(addr.id)}
                            className="text-red-400 hover:text-red-300 text-sm px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition self-start"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === 'pda' && pdaData && (
              <PDAExplorer
                projectId={projectId!}
                programId={pdaData.programId}
                pdaAccounts={pdaData.pdaAccounts || []}
              />
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && selectedProject.isOwner && (
              <div className="space-y-6">
                {/* Visibility Toggle */}
                <div className="card-static p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-white mb-1">Visibility</h3>
                      <p className="text-gray-400 text-sm mb-4">
                        {selectedProject.is_public
                          ? 'This project is public. Anyone can view the API.'
                          : 'This project is private. Only you can access it.'}
                      </p>
                      <button
                        onClick={handleToggleVisibility}
                        className="btn-secondary text-sm px-4 py-2"
                      >
                        Make {selectedProject.is_public ? 'Private' : 'Public'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* API Keys */}
                <div className="card-static p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-white">API Keys</h3>
                      <p className="text-gray-400 text-sm">Manage your API keys for programmatic access</p>
                    </div>
                    <button
                      onClick={handleGenerateKey}
                      className="btn-primary text-sm px-4 py-2"
                    >
                      Generate
                    </button>
                  </div>

                  {newKey && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-green-400 text-sm font-medium">
                          New API Key (copy now — it won't be shown again):
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-surface-elevated p-3 rounded-lg font-mono break-all">
                          {newKey}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(newKey)
                            showToast('Copied to clipboard', 'success')
                          }}
                          className="btn-secondary text-sm px-3 py-2"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  {apiKeys.length === 0 ? (
                    <p className="text-gray-500 text-sm">No API keys generated yet</p>
                  ) : (
                    <div className="grid gap-3">
                      {apiKeys.map((key: any) => (
                        <div
                          key={key.id}
                          className="flex items-center justify-between bg-surface-elevated p-3 rounded-xl"
                        >
                          <div className="min-w-0 flex-1">
                            <code className="text-xs font-mono text-gray-400 block truncate">{key.key}</code>
                            <p className="text-xs text-gray-600 mt-1">
                              Created: {new Date(key.created_at).toLocaleDateString()}
                              {key.last_used && ` · Last used: ${new Date(key.last_used).toLocaleDateString()}`}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeleteKey(key.id)}
                            className="text-red-400 hover:text-red-300 text-sm px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition ml-4"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Social Links */}
                <div className="card-static p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-white">Social Links</h3>
                      <p className="text-gray-400 text-sm">Add social media and website links for your project</p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                            </svg>
                            Twitter / X
                          </span>
                        </label>
                        <input
                          type="text"
                          value={socialsForm.twitter || ''}
                          onChange={(e) => setSocialsForm({ ...socialsForm, twitter: e.target.value })}
                          placeholder="@username or full URL"
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z" />
                            </svg>
                            Discord
                          </span>
                        </label>
                        <input
                          type="text"
                          value={socialsForm.discord || ''}
                          onChange={(e) => setSocialsForm({ ...socialsForm, discord: e.target.value })}
                          placeholder="Invite code or full URL"
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                            </svg>
                            Telegram
                          </span>
                        </label>
                        <input
                          type="text"
                          value={socialsForm.telegram || ''}
                          onChange={(e) => setSocialsForm({ ...socialsForm, telegram: e.target.value })}
                          placeholder="@channel or full URL"
                          className="input w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                            </svg>
                            GitHub
                          </span>
                        </label>
                        <input
                          type="text"
                          value={socialsForm.github || ''}
                          onChange={(e) => setSocialsForm({ ...socialsForm, github: e.target.value })}
                          placeholder="org/repo or full URL"
                          className="input w-full"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                          </svg>
                          Website
                        </span>
                      </label>
                      <input
                        type="text"
                        value={socialsForm.website || ''}
                        onChange={(e) => setSocialsForm({ ...socialsForm, website: e.target.value })}
                        placeholder="https://yourproject.com"
                        className="input w-full"
                      />
                    </div>
                    <button
                      onClick={handleSaveSocials}
                      disabled={isSavingSocials}
                      className="btn-primary w-full md:w-auto text-sm px-6 py-2"
                    >
                      {isSavingSocials ? 'Saving...' : 'Save Social Links'}
                    </button>
                  </div>
                </div>

                {/* Delete Project */}
                <div className="card-static p-6 border border-red-500/20">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                      <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-red-400 mb-1">Danger Zone</h3>
                      <p className="text-gray-400 text-sm mb-4">
                        Permanently delete this project and all associated data. This action cannot be undone.
                      </p>
                      <button
                        onClick={() => { setShowDeleteModal(true); setDeleteConfirmName(''); setDeleteError('') }}
                        className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-xl hover:bg-red-500/20 transition text-sm font-medium"
                      >
                        Delete Project
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card-static p-6 max-w-md w-full border border-red-500/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white">Delete Project</h3>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              This will permanently delete <strong className="text-white">{selectedProject.name}</strong> and all associated data.
              Type the project name to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={selectedProject.name}
              className="input w-full mb-3"
              autoFocus
            />
            {deleteError && (
              <p className="text-red-400 text-sm mb-3">{deleteError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleteConfirmName !== selectedProject.name}
                className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-xl hover:bg-red-500/20 transition text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
