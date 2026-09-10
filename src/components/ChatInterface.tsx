import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Card } from './ui/card'

export function ChatInterface() {
  const [messages, setMessages] = useState<{role: string, content: string}[]>([])
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (!input.trim()) return
    setMessages([...messages, { role: 'user', content: input }])
    setInput('')
    
    // Mock bot response
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'bot', content: `This is a mock response from Daedalus.` }])
    }, 500)
  }

  return (
    <div className="flex-1 flex flex-col p-6 gap-4 bg-zinc-900">
      <ScrollArea className="flex-1 pr-4">
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center text-zinc-500 mt-10">
              <p>Start a conversation with <strong>Daedalus</strong></p>
              <p className="text-sm mt-2">Try asking: "What is the current temperature?"</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <Card key={i} className={`p-3 max-w-[80%] ${msg.role === 'user' ? 'ml-auto bg-zinc-800 text-white border-zinc-700' : 'bg-zinc-950 border-emerald-900 text-zinc-300'}`}>
              <p className="text-sm">{msg.content}</p>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="flex gap-2">
        <Input 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={`Query the reactor state...`}
          className="bg-zinc-800 border-zinc-700 text-white"
        />
        <Button onClick={handleSend} className="bg-emerald-600 hover:bg-emerald-700 text-white">Send</Button>
      </div>
    </div>
  )
}
