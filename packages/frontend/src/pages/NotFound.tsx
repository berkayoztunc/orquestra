import { Link } from 'react-router-dom'

export default function NotFound(): JSX.Element {
  return (
    <div className="text-center py-12">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-sand-1100 mb-8">Page not found</p>
      <Link to="/" className="text-sand-1600 hover:text-sand-1400 transition font-semibold">
        Back to Home
      </Link>
    </div>
  )
}
