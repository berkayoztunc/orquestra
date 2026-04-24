import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import Header from './Header'
import Footer from './Footer'
import { registerWebMcpTools } from '@/lib/webmcp'

export default function Layout(): JSX.Element {
  // useEffect(() => {
  //   return registerWebMcpTools()
  // }, [])

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 pt-24">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
