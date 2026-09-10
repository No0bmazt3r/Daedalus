import { createFileRoute } from '@tanstack/react-router'
import { ChatInterface } from '../components/ChatInterface'

export const Route = createFileRoute('/device/$deviceId')({
  component: DeviceChatView,
})

export function DeviceChatView() {
  const { deviceId } = Route.useParams()

  return (
    <div className="flex flex-col h-full">
      <header className="h-14 border-b border-zinc-800 bg-zinc-950 flex items-center px-6">
        <h1 className="text-lg font-semibold text-zinc-200">
          Daedalus // <span className="text-emerald-400">{deviceId}</span>
        </h1>
      </header>
      
      <ChatInterface deviceId={deviceId} />
    </div>
  )
}
