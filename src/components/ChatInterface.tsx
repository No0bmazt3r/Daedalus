import { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { ScrollArea } from './ui/scroll-area'
import { Plus, Mic, ArrowUp, Zap, Ghost } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from "./ui/tooltip"

export function ChatInterface() {
  const [messages, setMessages] = useState<{role: string, content: string}[]>([])
  const [input, setInput] = useState('')
  const [isGhostMode, setIsGhostMode] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim()) return
    setMessages([...messages, { role: 'user', content: input }])
    setInput('')
    
    // Mock bot response
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'bot', content: `This is a mock response from Daedalus.` }])
    }, 500)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <TooltipProvider>
      <div className="flex-1 flex flex-col bg-black text-zinc-200 relative w-full h-full">
        {/* Top Header / Ghost Mode Toggle */}
        <div className="absolute top-4 right-6 z-50 flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsGhostMode(!isGhostMode)}
                className={`w-9 h-9 rounded-full transition-colors ${isGhostMode ? 'bg-zinc-800 text-emerald-400 border border-emerald-900/50' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
              >
                <Ghost size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="bg-zinc-800 border-zinc-700 text-zinc-200 text-xs">
              <p>{isGhostMode ? 'Temporary Chat (Enabled)' : 'Temporary Chat'}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 w-full">
            <div className="w-full max-w-3xl flex flex-col items-center justify-center">
              <div className="flex items-center gap-3 mb-8">
                <img src="/labyrinth.svg" alt="Daedalus Logo" className="w-10 h-10" />
                <h1 className="text-3xl font-serif tracking-tight text-zinc-100">Good afternoon, Operator</h1>
              </div>
              
              <div className="w-full bg-zinc-900 border border-zinc-700/50 rounded-2xl flex flex-col shadow-sm focus-within:ring-1 focus-within:ring-zinc-500/50 transition-all">
                <Textarea 
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="How can I help you today?"
                  className="bg-transparent border-0 resize-none focus-visible:ring-0 px-4 py-4 min-h-[56px] max-h-[200px] overflow-y-auto text-base placeholder:text-zinc-500"
                  rows={1}
                />
                
                <div className="flex items-center justify-between px-3 pb-3 pt-1">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700">
                      <Plus size={18} />
                    </Button>
                    <div className="flex items-center bg-zinc-800 rounded-lg p-0.5 border border-zinc-700">
                      <button className="px-3 py-1 text-xs font-medium bg-zinc-700 text-zinc-200 rounded-md shadow-sm">Chat</button>
                      <button className="px-3 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200">System</button>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className="flex items-center text-xs text-zinc-400 mr-2 cursor-pointer hover:text-zinc-300">
                      <Zap size={14} className="mr-1 text-emerald-500" /> Daedalus 2.0
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700">
                      <Mic size={18} />
                    </Button>
                    <Button 
                      onClick={handleSend} 
                      disabled={!input.trim()}
                      className="w-8 h-8 rounded-full bg-zinc-200 hover:bg-white text-zinc-900 disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500 p-0"
                    >
                      <ArrowUp size={18} strokeWidth={2.5} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 w-full">
              <div className="flex flex-col w-full max-w-3xl mx-auto py-8 px-4 gap-6 pb-32">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'bot' && (
                      <div className="w-8 h-8 mr-4 shrink-0 rounded-md flex items-center justify-center border border-zinc-700 bg-zinc-800">
                        <img src="/labyrinth.svg" alt="Daedalus" className="w-5 h-5" />
                      </div>
                    )}
                    <div className={`text-[15px] leading-relaxed ${msg.role === 'user' ? 'bg-zinc-800 px-5 py-3 rounded-2xl max-w-[80%]' : 'max-w-[85%] pt-1 text-zinc-300'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black to-transparent">
              <div className="max-w-3xl mx-auto w-full">
                <div className="w-full bg-zinc-900 border border-zinc-700/50 rounded-2xl flex flex-col shadow-lg focus-within:ring-1 focus-within:ring-zinc-500/50 transition-all">
                  <Textarea 
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="How can I help you today?"
                    className="bg-transparent border-0 resize-none focus-visible:ring-0 px-4 py-3 min-h-[44px] max-h-[200px] overflow-y-auto text-base placeholder:text-zinc-500"
                    rows={1}
                  />
                  
                  <div className="flex items-center justify-between px-3 pb-2 pt-1">
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700">
                      <Plus size={18} />
                    </Button>
                    
                    <Button 
                      onClick={handleSend} 
                      disabled={!input.trim()}
                      className="w-8 h-8 rounded-full bg-zinc-200 hover:bg-white text-zinc-900 disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500 p-0"
                    >
                      <ArrowUp size={18} strokeWidth={2.5} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
