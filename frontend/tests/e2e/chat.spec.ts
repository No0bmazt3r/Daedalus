import { test, expect, type Route } from '@playwright/test'
import fixtures from './api-fixtures.json' with { type: 'json' }

// The main path: ask a question → tokens stream → the stored answer renders with
// a citation that opens the evidence line it points at. Recorded from a real
// backend (`GET`s and the `done` event's shape); only the answer is scripted.
const recorded = fixtures as Record<string, unknown>
const ANSWER = 'First, switch the reactor to Manual [D1].'
const LINE = '[D1] SOP_Emergency_Cooldown.md [THIS RIG]: Switch the reactor to Manual.'

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

function answerStream(sessionId: string, question: string): string {
  const done = structuredClone(recorded.chat_done_template) as { result: Record<string, any> }
  const r = done.result
  r.session_id = sessionId
  r.answer = ANSWER
  r.model = 'qwen3:1.7b'
  r.intent = 'procedure'
  r.tools_used = ['search_corpus']
  r.user_message = { ...r.user_message, session_id: sessionId, content: question }
  r.message = {
    ...r.message,
    session_id: sessionId,
    content: ANSWER,
    model_tag: 'qwen3:1.7b',
    evidence: {
      citations: [{ label: 'D1', kind: 'document', tool: 'search_corpus', source_file: 'SOP_Emergency_Cooldown.md' }],
      lines: { D1: LINE },
      failures: [],
      notes: [],
      tools_used: ['search_corpus'],
    },
  }
  const pieces = ANSWER.split(' ').map((w) => ({ phase: 'generating', piece: `${w} ` }))
  return sse([{ phase: 'understood' }, { phase: 'evidence' }, ...pieces, { phase: 'validated' }, done])
}

test('a question gets a streamed, cited answer', async ({ page }) => {
  const session = recorded['POST /api/sessions'] as { session_id: string }
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const key = `${req.method()} ${path}`
    if (key === 'POST /api/chat') {
      const { message } = req.postDataJSON() as { message: string }
      return route.fulfill({ contentType: 'text/event-stream', body: answerStream(session.session_id, message) })
    }
    if (path === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: '' })
    if (path === '/api/prefs/theme.css') return route.fulfill({ contentType: 'text/css', body: '' })
    if (key in recorded) return route.fulfill({ json: recorded[key] })
    // Anything else the page asks for while idle: an empty object, which every
    // client treats as "nothing yet".
    return route.fulfill({ json: {} })
  })

  await page.goto('/')
  const box = page.getByRole('textbox').first()
  await box.fill('What are the first steps of the emergency cooldown?')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText('First, switch the reactor to Manual')).toBeVisible()
  await expect(page.getByText('D1', { exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
})
