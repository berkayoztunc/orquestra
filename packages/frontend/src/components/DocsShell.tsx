import { Outlet } from 'react-router-dom'

export default function DocsShell(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg1 text-sand-1500">
      <Outlet />
    </div>
  )
}
