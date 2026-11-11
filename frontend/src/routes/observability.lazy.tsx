import { createLazyFileRoute } from '@tanstack/react-router'
import { ObservabilityPage } from '../components/observability/ObservabilityPage'

// Lazy so Recharts loads with this page, not with the chat.
export const Route = createLazyFileRoute('/observability')({
  component: ObservabilityPage,
})
