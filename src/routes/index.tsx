import { createFileRoute } from '@tanstack/react-router'
import { ChatInterface } from '../components/ChatInterface'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className="flex flex-col h-full">
      <header className="h-14 border-b border-zinc-800 bg-zinc-950 flex items-center pl-14 pr-6">
        <h1 className="text-lg font-semibold text-zinc-200">
          Daedalus // <span className="text-emerald-400">Main Console</span>
        </h1>
      </header>
      
      <ChatInterface />
    </div>
  )
}
