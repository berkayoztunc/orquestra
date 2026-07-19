import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import DocsShell from '@/components/DocsShell'
import Home from '@/pages/Home'
import Dashboard from '@/pages/Dashboard'
import Explorer from '@/pages/Explorer'
import ProjectDetail from '@/pages/ProjectDetail'
import AuthCallback from '@/pages/AuthCallback'
import AuthError from '@/pages/AuthError'
import NotFound from '@/pages/NotFound'
import SignAndSend from '@/pages/SignAndSend'
import CLI from '@/pages/CLI'
import MCP from '@/pages/MCP'
import API from '@/pages/API'
import Packages from '@/pages/Packages'
import Analytics from '@/pages/Analytics'
import Lists from '@/pages/Lists'
import Updates from '@/pages/Updates'
import Sync from '@/pages/Sync'
import { ToastProvider } from '@/components/Toast'
import { useAuthStore } from '@/store/auth'

function App(): JSX.Element {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/project/:programId" element={<ProjectDetail />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/error" element={<AuthError />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/updates" element={<Updates />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route element={<DocsShell />}>
            <Route path="/docs/sign-and-send" element={<SignAndSend />} />
            <Route path="/docs/cli" element={<CLI />} />
            <Route path="/docs/mcp" element={<MCP />} />
            <Route path="/docs/api" element={<API />} />
            <Route path="/docs/packages" element={<Packages />} />
          </Route>
        </Routes>
      </Router>
    </ToastProvider>
  )
}

export default App
