import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Dashboard from '@/pages/Dashboard'
import Explorer from '@/pages/Explorer'
import ProjectDetail from '@/pages/ProjectDetail'
import AuthCallback from '@/pages/AuthCallback'
import AuthError from '@/pages/AuthError'
import NotFound from '@/pages/NotFound'
import SignAndSend from '@/pages/SignAndSend'
import CLI from '@/pages/CLI'
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
            <Route path="/docs/sign-and-send" element={<SignAndSend />} />
            <Route path="/cli" element={<CLI />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Router>
    </ToastProvider>
  )
}

export default App
