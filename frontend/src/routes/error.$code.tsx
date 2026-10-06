import { createFileRoute } from '@tanstack/react-router'
import { ErrorPage } from '../components/ErrorPage'

// `/error/404`, `/error/503`, … Any page can send the user here; an unknown or
// non-numeric code shows the closest family page (4xx or 5xx).
export const Route = createFileRoute('/error/$code')({
  component: ErrorRoute,
})

function ErrorRoute() {
  const { code } = Route.useParams()
  const n = Number(code)
  return <ErrorPage code={Number.isInteger(n) && n >= 400 && n <= 599 ? n : 404} preview />
}
