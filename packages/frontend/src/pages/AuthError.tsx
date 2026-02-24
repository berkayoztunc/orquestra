import { useSearchParams, Link } from 'react-router-dom'

export default function AuthError(): JSX.Element {
  const [searchParams] = useSearchParams()
  const message = searchParams.get('message') || 'An unknown error occurred'

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center max-w-md">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold mb-4">Authentication Failed</h1>
        <p className="text-gray-400 mb-8">{message}</p>
        <Link
          to="/"
          className="bg-primary text-dark-900 px-6 py-3 rounded-lg font-bold hover:bg-secondary transition inline-block"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}
