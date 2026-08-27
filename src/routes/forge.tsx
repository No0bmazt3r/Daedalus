import { createFileRoute } from '@tanstack/react-router'
import { Cpu, HardDrive, Zap, CheckCircle2, AlertTriangle } from 'lucide-react'

export const Route = createFileRoute('/forge')({
  component: ArchitectForge,
})

function ArchitectForge() {
  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 px-6 flex items-center justify-between border-b border-daedalus-border/50">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-daedalus-gold">The Architect's Forge</h2>
          <span className="px-2 py-1 text-xs rounded bg-daedalus-slate text-daedalus-text-muted border border-daedalus-border">
            System Profiler & Model Config
          </span>
        </div>
        <button className="px-4 py-1.5 text-sm font-medium bg-daedalus-copper text-white rounded-md hover:bg-daedalus-copper/90 transition-colors">
          Run Hardware Scan
        </button>
      </header>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {/* Hardware Specs */}
          <section>
            <h3 className="text-sm font-medium text-daedalus-text-muted uppercase tracking-wider mb-4">Hardware Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-daedalus-slate p-4 rounded-lg border border-daedalus-border flex items-start gap-4">
                <Cpu className="text-daedalus-text-muted" />
                <div>
                  <p className="text-sm text-daedalus-text-muted">CPU</p>
                  <p className="font-medium">Detecting...</p>
                </div>
              </div>
              <div className="bg-daedalus-slate p-4 rounded-lg border border-daedalus-border flex items-start gap-4">
                <HardDrive className="text-daedalus-text-muted" />
                <div>
                  <p className="text-sm text-daedalus-text-muted">System RAM</p>
                  <p className="font-medium">Detecting...</p>
                </div>
              </div>
              <div className="bg-daedalus-slate p-4 rounded-lg border border-daedalus-border flex items-start gap-4">
                <Zap className="text-daedalus-copper" />
                <div>
                  <p className="text-sm text-daedalus-text-muted">GPU / VRAM</p>
                  <p className="font-medium text-daedalus-copper">Detecting...</p>
                </div>
              </div>
            </div>
          </section>
          
          {/* Model Recommendations */}
          <section>
            <h3 className="text-sm font-medium text-daedalus-text-muted uppercase tracking-wider mb-4">Recommended Local Models</h3>
            <div className="space-y-4">
              
              <div className="bg-daedalus-slate p-5 rounded-lg border border-emerald-500/30 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-lg">Qwen 3 (1.7B)</h4>
                    <span className="px-2 py-0.5 text-[10px] rounded bg-daedalus-border text-daedalus-text-muted">Q4_K_M</span>
                  </div>
                  <p className="text-sm text-daedalus-text-muted mt-1">SLM Tier • ~1.8GB RAM Required</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-sm text-emerald-500">
                    <CheckCircle2 size={16} /> Safe
                  </span>
                  <button className="px-3 py-1.5 text-sm bg-daedalus-border hover:bg-daedalus-border/80 rounded transition-colors">
                    Download
                  </button>
                </div>
              </div>
              
              <div className="bg-daedalus-slate p-5 rounded-lg border border-daedalus-copper/30 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-lg">Phi-3 Mini (3.8B)</h4>
                    <span className="px-2 py-0.5 text-[10px] rounded bg-daedalus-border text-daedalus-text-muted">Q4_K_M</span>
                  </div>
                  <p className="text-sm text-daedalus-text-muted mt-1">SLM Tier • ~3.0GB RAM Required</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-sm text-daedalus-copper">
                    <AlertTriangle size={16} /> Marginal
                  </span>
                  <button className="px-3 py-1.5 text-sm bg-daedalus-border hover:bg-daedalus-border/80 rounded transition-colors">
                    Download
                  </button>
                </div>
              </div>
              
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
