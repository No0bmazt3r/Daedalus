import { createFileRoute } from '@tanstack/react-router'
import { Database, FileText, GitGraph } from 'lucide-react'

export const Route = createFileRoute('/labyrinth')({
  component: LabyrinthRAG,
})

function LabyrinthRAG() {
  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 px-6 flex items-center border-b border-daedalus-border/50">
        <h2 className="text-lg font-semibold text-daedalus-gold">Ariadne's Thread</h2>
        <span className="ml-4 px-2 py-1 text-xs rounded bg-daedalus-slate text-daedalus-text-muted border border-daedalus-border">
          Agentic RAG Pipeline
        </span>
      </header>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-8">
          <p className="text-daedalus-text-muted">
            Visualize and manage the knowledge graph and vector retrieval pipeline for the reactor SOPs and manuals.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-daedalus-slate rounded-lg p-6 border border-daedalus-border flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
                <FileText size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-daedalus-text">Ingestion Layer</h3>
                <p className="text-sm text-daedalus-text-muted mt-2">14 Document Sources Indexed</p>
              </div>
            </div>
            
            <div className="bg-daedalus-slate rounded-lg p-6 border border-daedalus-border flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center">
                <Database size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-daedalus-text">Vector Store</h3>
                <p className="text-sm text-daedalus-text-muted mt-2">ChromaDB • 2,451 Chunks</p>
              </div>
            </div>
            
            <div className="bg-daedalus-slate rounded-lg p-6 border border-daedalus-border flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-daedalus-copper/10 text-daedalus-copper flex items-center justify-center">
                <GitGraph size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-daedalus-text">Graph Agent</h3>
                <p className="text-sm text-daedalus-text-muted mt-2">Routing & Synthesis Active</p>
              </div>
            </div>
          </div>
          
          <div className="mt-8 bg-daedalus-slate rounded-lg border border-daedalus-border p-6 h-64 flex items-center justify-center">
            <p className="text-daedalus-text-muted italic">[ Interactive Graph Visualization Placeholder ]</p>
          </div>
        </div>
      </div>
    </div>
  )
}
