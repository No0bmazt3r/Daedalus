import type { ErrorInfo } from './types'

// Every file in codes/ is picked up by its name: add `codes/<code>.ts` and the
// page exists, with nothing else to register.
const modules = import.meta.glob<{ default: ErrorInfo }>('./codes/*.ts', { eager: true })

export const ERRORS: Record<number, ErrorInfo> = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => [Number(path.match(/(\d{3})\.ts$/)?.[1]), mod.default]),
)
