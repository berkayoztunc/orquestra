import { useSearchParams, Link } from 'react-router-dom'

export default function AuthError(): JSX.Element {
  const [searchParams] = useSearchParams()
  const message = searchParams.get('message') || 'An unknown error occurred'

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center max-w-md">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold mb-4">Authentication Failed</h1>
        <p className="text-sand-1100 mb-8">{message}</p>
        <Link
          to="/"
          className="bg-sand-1600 text-bg1 px-6 py-3 font-bold hover:bg-sand-1400 transition inline-block"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}
