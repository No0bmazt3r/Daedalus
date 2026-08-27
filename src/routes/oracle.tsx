import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'

export const Route = createFileRoute('/oracle')({
  component: OracleChat,
})

function OracleChat() {
  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 px-6 flex items-center border-b border-daedalus-border/50">
        <h2 className="text-lg font-semibold text-daedalus-gold">The Oracle</h2>
        <span className="ml-4 px-2 py-1 text-xs rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          Agent Ready
        </span>
      </header>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Placeholder for chat messages */}
        <div className="flex gap-4 max-w-3xl">
          <div className="w-8 h-8 rounded bg-daedalus-copper/20 border border-daedalus-copper/50 flex items-center justify-center text-daedalus-copper font-bold flex-shrink-0">
            D
          </div>
          <div className="bg-daedalus-slate rounded-lg rounded-tl-none p-4 border border-daedalus-border">
            <p className="text-daedalus-text">Greetings, operator. I am Daedalus, the read-only AI monitor for the CO₂ Sorption Reactor. How may I assist you today?</p>
          </div>
        </div>
      </div>
      
      <div className="p-4 border-t border-daedalus-border/50 bg-daedalus-obsidian/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto relative">
          <input 
            type="text" 
            placeholder="Query the reactor state or request SOPs..." 
            className="w-full bg-daedalus-slate border border-daedalus-border rounded-lg py-3 pl-4 pr-12 text-daedalus-text placeholder:text-daedalus-text-muted focus:outline-none focus:border-daedalus-copper/50 focus:ring-1 focus:ring-daedalus-copper/50 transition-all"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-daedalus-text-muted hover:text-daedalus-copper transition-colors">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
