import { Outlet } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import { TopFade } from '@/ui/HeroDecor'

export default function Layout(): JSX.Element {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-sand-1500">
      <TopFade />
      <div className="relative z-10">
        <Header />
        <main className="px-4 sm:px-6 lg:px-8">
          <div className="mx-auto min-h-[calc(100vh-180px)] w-full max-w-7xl border-x border-border-low">
            <Outlet />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  )
}
