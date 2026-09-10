import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => <Navigate to="/device/$deviceId" params={{ deviceId: 'co2-reactor-01' }} />,
})
