import { LabyrinthIcon } from "./LabyrinthIcon";
import { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { ScrollArea } from './ui/scroll-area'
import { Plus, Mic, ArrowUp, Zap } from 'lucide-react'

export function ChatInterface() {
  const [messages, setMessages] = useState<{role: string, content: string}[]>([])
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    <div className="flex-1 flex flex-col theme-bg theme-text relative w-full h-full transition-colors duration-200">
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-8">
            <LabyrinthIcon className="w-10 h-10 text-[var(--text-main)]" />
            <h1 className="text-3xl font-serif tracking-tight">Good afternoon, Operator</h1>
          </div>
          
          <div className="w-full theme-card border theme-border rounded-2xl flex flex-col shadow-sm focus-within:ring-1 focus-within:ring-zinc-500/50 transition-all">
            <Textarea 
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="How can I help you today?"
              className="bg-transparent border-0 resize-none focus-visible:ring-0 px-4 py-4 min-h-[56px] max-h-[200px] overflow-y-auto text-base placeholder:opacity-50"
              rows={1}
            />
            
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full theme-text-muted hover:theme-text hover:bg-black/20">
                  <Plus size={18} />
                </Button>
                <div className="flex items-center bg-black/20 rounded-lg p-0.5 border theme-border">
                  <button className="px-3 py-1 text-xs font-medium bg-black/40 rounded-md shadow-sm">Chat</button>
                  <button className="px-3 py-1 text-xs font-medium theme-text-muted hover:theme-text">System</button>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="flex items-center text-xs theme-text-muted mr-2 cursor-pointer hover:theme-text">
                  <Zap size={14} className="mr-1 theme-primary" /> Daedalus 2.0
                </div>
                <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full theme-text-muted hover:theme-text hover:bg-black/20">
                  <Mic size={18} />
                </Button>
                <Button 
                  onClick={handleSend} 
                  disabled={!input.trim()}
                  className="w-8 h-8 rounded-full theme-bg-primary hover:opacity-80 text-black disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500 p-0"
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 w-full">
            <div className="flex flex-col max-w-3xl mx-auto py-8 px-4 gap-6 pb-32">
              {messages.map((msg, i) => (
                <div key={i} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'bot' && (
                    <div className="w-8 h-8 mr-4 shrink-0 rounded-md flex items-center justify-center border theme-border theme-card">
                      <LabyrinthIcon className="w-5 h-5 text-[var(--text-main)]" />
                    </div>
                  )}
                  <div className={`text-[15px] leading-relaxed ${msg.role === 'user' ? 'theme-sidebar px-5 py-3 rounded-2xl max-w-[80%]' : 'max-w-[85%] pt-1'}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="max-w-3xl mx-auto w-full">
              <div className="w-full theme-card border theme-border rounded-2xl flex flex-col shadow-lg focus-within:ring-1 focus-within:ring-zinc-500/50 transition-all">
                <Textarea 
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="How can I help you today?"
                  className="bg-transparent border-0 resize-none focus-visible:ring-0 px-4 py-3 min-h-[44px] max-h-[200px] overflow-y-auto text-base placeholder:opacity-50"
                  rows={1}
                />
                
                <div className="flex items-center justify-between px-3 pb-2 pt-1">
                  <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full theme-text-muted hover:theme-text hover:bg-black/20">
                    <Plus size={18} />
                  </Button>
                  
                  <Button 
                    onClick={handleSend} 
                    disabled={!input.trim()}
                    className="w-8 h-8 rounded-full theme-bg-primary hover:opacity-80 text-black disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500 p-0"
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
  )
}
