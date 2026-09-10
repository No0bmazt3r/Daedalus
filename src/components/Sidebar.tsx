import { Link, useMatchRoute } from '@tanstack/react-router'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'

const MOCK_DEVICES = [
  { id: 'co2-reactor-01', name: 'CO₂ Sorption Rig 1' },
  { id: 'water-pump-02', name: 'Water Treatment Pump' },
]

export function Sidebar() {
  const matchRoute = useMatchRoute()

  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950 border-r border-zinc-800">
      <div className="flex items-center gap-3 mb-6 px-2">
        <img src="/labyrinth.svg" alt="Daedalus Logo" className="w-8 h-8" />
        <h2 className="text-xl font-bold text-emerald-400">DAEDALUS</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2">
          {MOCK_DEVICES.map((device) => {
            const isActive = matchRoute({ to: `/device/${device.id}` })
            return (
              <Link key={device.id} to="/device/$deviceId" params={{ deviceId: device.id }}>
                <Button 
                  variant={isActive ? "secondary" : "ghost"} 
                  className="w-full justify-start text-left text-zinc-300 hover:text-white"
                >
                  {device.name}
                </Button>
              </Link>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
