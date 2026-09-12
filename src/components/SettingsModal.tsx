import { useState } from 'react'
import { X, Plus, List, Cpu, Search, Link, Mail, Bell, Palette, Keyboard, User, Wrench, Users, Settings2, Ghost, CircleDashed, ChevronLeft, ChevronRight } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { useSettings } from '../contexts/SettingsContext'

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ 
  open, 
  onClose
}: SettingsModalProps) {
  const { isIncognito, setIsIncognito, selectedModel, setSelectedModel } = useSettings();
  const [activeTab, setActiveTab] = useState("ai")
  const [isPeek, setIsPeek] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { position, onMouseDown, handleRef, windowRef } = useDraggable()
  
  const models = ['Daedalus 2.0', 'Daedalus Pro', 'Daedalus Flash', 'Daedalus Vision']

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
      <div 
        className="fixed inset-0 bg-black/40 pointer-events-auto transition-opacity duration-300"
        style={{ opacity: isPeek ? 0 : 1 }}
        onClick={onClose}
      />
      
      <div
        ref={windowRef}
        style={{ 
          transform: `translate(${position.x}px, ${position.y}px)`,
          backgroundColor: isPeek ? 'color-mix(in srgb, var(--bg, #000) 55%, transparent)' : undefined,
          backdropFilter: isPeek ? 'none' : undefined,
        }}
        className={`pointer-events-auto absolute w-[850px] h-[650px] max-w-[95vw] max-h-[90vh] flex flex-col theme-bg theme-text theme-border border rounded-xl shadow-2xl overflow-hidden transition-colors duration-300 ${isPeek ? 'border-white/20 shadow-none' : ''}`}
      >
        {/* Header */}
        <div 
          ref={handleRef}
          onMouseDown={onMouseDown}
          className="flex items-center justify-between px-4 py-3 border-b theme-border cursor-move bg-black/10 select-none"
          style={{ backgroundColor: isPeek ? 'transparent' : undefined }}
        >
          <div className="flex items-center gap-2 font-medium">
            <Settings2 size={16} />
            <span>Settings</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsPeek(!isPeek)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium border ${isPeek ? 'bg-primary/20 text-[var(--primary)] border-[var(--primary)]/30' : 'theme-text-muted hover:theme-text border-transparent hover:bg-black/20'}`}
              title="Fade this window to preview the page behind it"
            >
              <CircleDashed size={14} className={isPeek ? "animate-[spin_4s_linear_infinite]" : ""} />
              Peek
            </button>
            <button 
              onClick={onClose}
              className="p-1 rounded-md hover:bg-black/20 theme-text-muted hover:theme-text transition-colors ml-2"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div 
            className={`border-r theme-border bg-black/5 overflow-y-auto py-2 transition-all duration-300 flex flex-col ${sidebarCollapsed ? 'w-[60px]' : 'w-[220px]'}`}
            style={{ backgroundColor: isPeek ? 'transparent' : undefined }}
          >
            <div className="flex justify-end px-2 mb-2">
              <button 
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-1.5 rounded-md hover:bg-black/10 theme-text-muted hover:theme-text"
              >
                {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>

            {!sidebarCollapsed && <div className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider theme-text-muted">General</div>}
            
            <NavButton id="services" icon={Plus} label="Add Models" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="added-models" icon={List} label="Added Models" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="ai" icon={Cpu} label="AI Defaults" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="search" icon={Search} label="Search" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="integrations" icon={Link} label="Integrations" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="email" icon={Mail} label="Email" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="reminders" icon={Bell} label="Reminders" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />

            {!sidebarCollapsed && <div className="px-3 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wider theme-text-muted">UX</div>}
            <NavButton id="appearance" icon={Palette} label="Appearance" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="shortcuts" icon={Keyboard} label="Shortcuts" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />

            {!sidebarCollapsed && <div className="px-3 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wider theme-text-muted">Account</div>}
            <NavButton id="account" icon={User} label="Account" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />

            {!sidebarCollapsed && <div className="px-3 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wider theme-text-muted">Admin</div>}
            <NavButton id="tools" icon={Wrench} label="Agent Tools" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="users" icon={Users} label="Users" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
            <NavButton id="system" icon={Settings2} label="System" active={activeTab} set={setActiveTab} col={sidebarCollapsed} />
          </div>

          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-8 bg-transparent">
            {activeTab === 'ai' && (
              <div className="space-y-6 animate-in fade-in duration-200 max-w-2xl">
                <div>
                  <h3 className="text-xl font-medium mb-1">AI Defaults</h3>
                  <p className="text-sm theme-text-muted mb-6">Manage your default models and AI settings.</p>
                </div>
                
                <div className={`p-6 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'bg-black/10'}`}>
                  <div className="flex flex-col gap-3">
                    <label className="text-sm font-medium">Default Chat Model</label>
                    <select 
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className={`w-full p-2.5 rounded-lg border theme-border theme-text outline-none focus:ring-1 focus:ring-primary transition-colors ${isPeek ? 'bg-black/40' : 'bg-black/20'}`}
                    >
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <p className="text-xs theme-text-muted mt-1">This model will be selected by default for new conversations.</p>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'shortcuts' && (
              <div className="space-y-6 animate-in fade-in duration-200 max-w-2xl">
                <div>
                  <h3 className="text-xl font-medium mb-1">Shortcuts & Toggles</h3>
                  <p className="text-sm theme-text-muted mb-6">Configure keyboard shortcuts and quick toggles.</p>
                </div>
                
                <div className="space-y-4">
                  <div className={`flex items-center justify-between p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'bg-black/10'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-lg ${isIncognito ? 'bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'bg-black/20 theme-text-muted'}`}>
                        <Ghost size={22} />
                      </div>
                      <div>
                        <div className="font-medium text-base">Incognito Mode</div>
                        <div className="text-sm theme-text-muted mt-0.5">Pause history recording for this session. Your prompts will not be saved.</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => setIsIncognito(!isIncognito)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${isIncognito ? 'bg-indigo-500' : 'bg-zinc-600'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${isIncognito ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab !== 'ai' && activeTab !== 'shortcuts' && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4 animate-in fade-in duration-200">
                <Settings2 size={48} className="theme-text-muted opacity-30" />
                <div>
                  <h3 className="text-lg font-medium theme-text-muted">Work in Progress</h3>
                  <p className="text-sm theme-text-muted/70 max-w-sm mx-auto mt-2">This settings panel is mapped from Odysseus architecture. Additional modules are under construction.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NavButton({ id, icon: Icon, label, active, set, col }: any) {
  const isActive = active === id;
  return (
    <button
      onClick={() => set(id)}
      className={`w-full flex items-center px-4 py-2.5 text-sm transition-colors ${isActive ? "bg-black/20 theme-text font-medium border-r-2 border-[var(--primary)]" : "theme-text-muted hover:bg-black/10 hover:theme-text border-r-2 border-transparent"} ${col ? 'justify-center px-0' : 'gap-3'}`}
      title={col ? label : undefined}
    >
      <Icon size={16} />
      {!col && <span>{label}</span>}
    </button>
  )
}
