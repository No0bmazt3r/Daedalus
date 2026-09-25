// The browser end of `GET /api/events` — see backend `services/live_events.py`.
//
// One EventSource for the whole tab, however many views listen: a connection
// per view would multiply against the browser's per-host limit of six, and a
// view that opened its own would also have to close it. The connection opens
// with the first subscriber and closes with the last.
//
// Events name a topic and carry no data. A listener re-fetches what it shows,
// so there is still one source of truth for every list.

export type LiveTopic = 'models' | 'embeddings' | 'endpoints'

const TOPICS: LiveTopic[] = ['models', 'embeddings', 'endpoints']

type Listener = { topics: ReadonlySet<LiveTopic>; fn: () => void }

const listeners = new Set<Listener>()
let source: EventSource | null = null
let everConnected = false

function notify(topic: LiveTopic | 'all') {
  for (const l of listeners) {
    if (topic === 'all' || l.topics.has(topic)) {
      try {
        l.fn()
      } catch {
        // One broken listener must not stop the others hearing about it.
      }
    }
  }
}

function connect() {
  if (source) return
  source = new EventSource('/api/events')
  // `ready` arrives on every (re)connect. The first is the page loading, and
  // every view fetched on mount anyway. A later one means the stream dropped —
  // the backend restarted, the laptop slept — and anything could have changed
  // while nobody was listening, so every listener re-fetches. EventSource
  // reconnects by itself; this is what makes a reconnect also a resync.
  source.addEventListener('ready', () => {
    if (everConnected) notify('all')
    everConnected = true
  })
  for (const topic of TOPICS) {
    source.addEventListener(topic, () => notify(topic))
  }
}

function disconnect() {
  source?.close()
  source = null
  everConnected = false
}

/** Call `fn` whenever any of `topics` changes. Returns the unsubscribe. */
export function subscribe(topics: LiveTopic[], fn: () => void): () => void {
  const entry: Listener = { topics: new Set(topics), fn }
  listeners.add(entry)
  connect()
  return () => {
    listeners.delete(entry)
    if (!listeners.size) disconnect()
  }
}
