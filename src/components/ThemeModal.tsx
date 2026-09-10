import { useState, useEffect } from 'react'
import { THEMES, applyTheme } from '../lib/themes'
import type { Theme } from '../lib/themes'
import { X, Paintbrush, SwatchBook } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

interface ThemeModalProps {
  open: boolean;
  onClose: () => void;
}

export function ThemeModal({ open, onClose }: ThemeModalProps) {
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('daedalus-theme') || 'oled'
    }
    return 'oled'
  })

  const { position, onMouseDown, handleRef, windowRef } = useDraggable()

  useEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme])

  const handleSelectTheme = (themeId: string) => {
    setCurrentTheme(themeId)
    applyTheme(themeId)
  }

  if (!open) return null

  const style: React.CSSProperties = (position.x !== 0 || position.y !== 0) 
    ? { top: position.y, left: position.x, right: 'auto', bottom: 'auto' }
    : {} 

  return (
    <div 
      ref={windowRef}
      style={style}
      className={`fixed ${position.x === 0 ? 'top-20 right-20' : ''} w-[450px] min-h-[300px] resize bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-[100] theme-sidebar theme-border theme-text flex flex-col overflow-hidden`}
    >
      
      {/* Header (Draggable) */}
      <div 
        ref={handleRef}
        onMouseDown={onMouseDown}
        className="flex items-center justify-between p-3 border-b border-zinc-800 theme-border bg-black/20 cursor-move"
      >
        <div className="flex items-center gap-2">
           <Paintbrush size={16} className="theme-primary" />
           <span className="text-sm font-semibold select-none">Theme & Appearance</span>
        </div>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="p-1 hover:bg-black/20 rounded theme-text-muted hover:theme-text">
          <X size={16} />
        </button>
      </div>

      <Tabs defaultValue="themes" className="flex flex-col flex-1 overflow-hidden">
        <div className="px-4 pt-3 border-b theme-border bg-black/10">
          <TabsList className="bg-transparent p-0 gap-4 h-auto">
            <TabsTrigger 
              value="themes" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[var(--primary)] data-[state=active]:text-[var(--primary)] rounded-none px-1 pb-2 theme-text-muted hover:theme-text transition-colors"
            >
              <SwatchBook size={14} className="mr-2" /> Themes
            </TabsTrigger>
            <TabsTrigger 
              value="customize" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[var(--primary)] data-[state=active]:text-[var(--primary)] rounded-none px-1 pb-2 theme-text-muted hover:theme-text transition-colors"
            >
              <Paintbrush size={14} className="mr-2" /> Customize
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="themes" className="flex-1 overflow-y-auto p-4 m-0 scrollbar-thin scrollbar-thumb-zinc-700">
          <h3 className="text-xs font-semibold theme-text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full theme-bg-primary"></div>
            Default Themes
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {THEMES.map((theme: Theme) => (
              <button
                key={theme.id}
                onClick={() => handleSelectTheme(theme.id)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all hover:scale-105 ${currentTheme === theme.id ? 'theme-border bg-black/20 ring-1 ring-[var(--primary)] shadow-md' : 'border-black/20 hover:bg-black/10'}`}
              >
                <div className="flex -space-x-1.5 mb-2">
                  <div className="w-5 h-5 rounded-full border border-black/40 shadow-sm" style={{ backgroundColor: theme.colors.bg }} />
                  <div className="w-5 h-5 rounded-full border border-black/40 shadow-sm z-10" style={{ backgroundColor: theme.colors.sidebar }} />
                  <div className="w-5 h-5 rounded-full border border-black/40 shadow-sm z-20" style={{ backgroundColor: theme.colors.primary }} />
                </div>
                <span className="text-[10px] font-medium opacity-80">{theme.name.toLowerCase()}</span>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="customize" className="flex-1 overflow-y-auto p-4 m-0">
          <div className="space-y-6">
            <div className="p-4 rounded-lg border theme-border bg-black/10">
              <h4 className="text-sm font-semibold mb-4 flex items-center gap-2">
                 <Paintbrush size={14} className="theme-primary" /> Colors
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs theme-text-muted">Background</span>
                  <div className="w-6 h-6 rounded-full border border-black/40 theme-bg cursor-pointer" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs theme-text-muted">Text</span>
                  <div className="w-6 h-6 rounded-full border border-black/40 bg-[var(--text-main)] cursor-pointer" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs theme-text-muted">Panel</span>
                  <div className="w-6 h-6 rounded-full border border-black/40 theme-sidebar cursor-pointer" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs theme-text-muted">Accent</span>
                  <div className="w-6 h-6 rounded-full border border-black/40 theme-bg-primary cursor-pointer" />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg border theme-border bg-black/10">
               <h4 className="text-sm font-semibold mb-4">Background Effect</h4>
               <select className="w-full bg-black/40 border theme-border rounded px-3 py-2 text-sm theme-text focus:outline-none">
                 <option>None</option>
                 <option>Rain</option>
                 <option>Constellations</option>
                 <option>Dots</option>
               </select>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Resize handle in bottom right */}
      <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center opacity-50 hover:opacity-100">
         <div className="w-2 h-2 border-r-2 border-b-2 theme-border rotate-0" />
      </div>

    </div>
  )
}
