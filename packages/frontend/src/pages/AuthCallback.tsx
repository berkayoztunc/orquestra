import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function AuthCallback(): JSX.Element {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setToken, loadUser } = useAuthStore()

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      setToken(token)
      loadUser().then(() => {
        navigate('/dashboard', { replace: true })
      })
    } else {
      navigate('/', { replace: true })
    }
  }, [searchParams, setToken, loadUser, navigate])

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-gray-400">Authenticating...</p>
      </div>
    </div>
  )
}
