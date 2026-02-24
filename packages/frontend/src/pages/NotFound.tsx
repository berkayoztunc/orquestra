import { Link } from 'react-router-dom'

export default function NotFound(): JSX.Element {
  return (
    <div className="text-center py-12">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-gray-400 mb-8">Page not found</p>
      <Link to="/" className="text-primary hover:text-secondary transition font-semibold">
        Back to Home
      </Link>
    </div>
  )
}
