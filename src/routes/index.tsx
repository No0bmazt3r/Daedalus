import { createFileRoute } from '@tanstack/react-router'
import { ChatInterface } from '../components/ChatInterface'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className="flex flex-col h-full w-full">
      <ChatInterface />
    </div>
  )
}
