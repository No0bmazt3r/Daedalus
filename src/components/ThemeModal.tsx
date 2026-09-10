import { useState, useEffect } from 'react'
import { THEMES, applyTheme } from "../lib/themes";
import type { Theme } from '../lib/themes'
import { X, Check } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'

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
  }, [])

  const handleSelectTheme = (themeId: string) => {
    setCurrentTheme(themeId)
    applyTheme(themeId)
  }

  if (!open) return null

  // Determine styles for dragging vs initial position
  const style: React.CSSProperties = (position.x !== 0 || position.y !== 0) 
    ? { top: position.y, left: position.x, right: 'auto', bottom: 'auto' }
    : {} // Relies on Tailwind default classes top-20 right-20

  return (
    <div 
      ref={windowRef}
      style={style}
      className={`fixed ${position.x === 0 ? 'top-20 right-20' : ''} w-80 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-[100] theme-sidebar theme-border theme-text flex flex-col overflow-hidden`}
    >
      
      {/* Header (Draggable) */}
      <div 
        ref={handleRef}
        onMouseDown={onMouseDown}
        className="flex items-center justify-between p-3 border-b border-zinc-800 theme-border bg-black/20 cursor-move"
      >
        <span className="text-sm font-medium select-none">Theme & Appearance</span>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-3 overflow-y-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-zinc-700">
        {THEMES.map((theme: Theme) => (
          <button
            key={theme.id}
            onClick={() => handleSelectTheme(theme.id)}
            className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${currentTheme === theme.id ? 'theme-border bg-black/20' : 'border-transparent hover:bg-black/10'}`}
          >
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="w-5 h-5 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: theme.colors.bg }} />
                <div className="w-5 h-5 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: theme.colors.sidebar }} />
                <div className="w-5 h-5 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: theme.colors.primary }} />
              </div>
              <span className="text-sm font-medium">{theme.name}</span>
            </div>
            {currentTheme === theme.id && <Check size={16} className="theme-primary" />}
          </button>
        ))}
      </div>
    </div>
  )
}
