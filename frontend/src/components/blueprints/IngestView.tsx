import { useCallback, useEffect, useState } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { Upload, Play, Scissors, Cpu } from 'lucide-react'
import {
  fetchCorpusStatus, fetchCorpusDocuments, deleteDocument, fetchCorpusConfig, fetchRun, type CorpusStatus, type CorpusDocument, type CorpusConfig, type IngestRun,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { StepRail, StepFooter, type Step } from '../ui/stepper'
import { ImportStep } from './ingest/ImportStep'
import { ChunkStep } from './ingest/ChunkStep'
import { EmbeddingStep } from './ingest/EmbeddingStep'
import { RunStep } from './ingest/RunStep'

/**
 * The ingestion pipeline, as the four steps it actually is — MODULES.md §3.1.
 *
 * This is the **Build** tab, Track 1's counterpart to Track 2's graph authoring:
 * each arm gets knowledge a different way, and this is Track 1's way. It used to
 * be the *Corpus* tab, which was a misnomer — the corpus is the artefact, and
 * this screen is the machinery that produces it. The artefact now has its own
 * tab, which is what that name is for.
 *
 * `architecture/04` Steps 1-6: import, chunk, embed, run. The first build put
 * all four on one page, which was wrong for a reason worth writing down: they
 * are **sequential and dependent**, not four independent panels. Chunk settings
 * mean nothing without a document to chunk; an embedding model cannot be checked
 * against an index that does not exist yet; a run is the consequence of the
 * three decisions above it. A page that shows all four at once shows three
 * things you cannot act on and gives no clue which one to touch first.
 *
 * So it is a stepper, and the steps gate:
 *
 * ```
 * 1 Import ──▶ 2 Chunk ──▶ 3 Embedding ──▶ 4 Run
 *   documents    boundaries   the model        writes
 * ```
 *
 * ## Going back is always allowed; going forward is not
 *
 * Every completed step stays clickable, because the whole point of adjusting
 * chunk settings is that you do it repeatedly while looking at the preview. What
 * is gated is *forward*: you cannot reach Run without documents, because a run
 * with nothing to ingest is a button that produces an error instead of a result.
 * The rail says why a step is not reachable rather than just disabling it.
 *
 * ## An empty corpus is the normal starting state
 *
 * Step 1 with nothing in it is not an error and does not say "no data". It is
 * where the pipeline begins, and the panel reads as an instruction rather than
 * as an empty table — MODULES.md §0 rule 4 is about explaining, and at this
 * point the explanation is "start here".
 *
 * ## Why the embedding model is a step and not a link
 *
 * It used to be reported here and chosen in the Forge. But it is the one
 * decision in this flow that is *irreversible with respect to the work*:
 * changing it after ingesting invalidates every vector, because vectors from two
 * models are not comparable. Making it a step you pass through before the run —
 * rather than a fact you notice afterwards — is what stops that being learned
 * the expensive way.
 */

const STEPS: readonly Step[] = [
  { id: 1, label: 'Import', icon: Upload, hint: 'Add the documents to index' },
  { id: 2, label: 'Chunk', icon: Scissors, hint: 'Decide where they get split' },
  { id: 3, label: 'Embedding', icon: Cpu, hint: 'Choose the model that turns chunks into vectors' },
  { id: 4, label: 'Run', icon: Play, hint: 'Ingest, and watch it happen' },
]

export function IngestView({ onOpenForge }: { onOpenForge?: () => void }) {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [documents, setDocuments] = useState<CorpusDocument[]>([])
  const [config, setConfig] = useState<CorpusConfig | null>(null)
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<IngestRun | null>(null)

  // The pipeline's state cannot be read: the tab is the error page, not a
  // skeleton that never resolves. `error` is a failed action.
  const [loadError, setLoadError] = useState<LoadFailure | null>(null)
  const refresh = useCallback(() => {
    void Promise.all([fetchCorpusStatus(), fetchCorpusDocuments(), fetchCorpusConfig()])
      .then(([st, docs, cfg]) => { setStatus(st); setDocuments(docs.documents); setConfig(cfg); setLoadError(null) })
      .catch((e: unknown) => setLoadError(toFailure(e)))
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useLiveRefresh(['corpus'], refresh)

  // A run is a server-side job that outlives this component, so on mount we
  // adopt whatever is already going — and jump to the step that shows it,
  // because a pipeline halfway through a corpus is the thing you opened to see.
  useEffect(() => {
    if (!status?.active_run || activeRun?.run_id === status.active_run) return
    void fetchRun(status.active_run)
      .then((r) => { setActiveRun(r.run); setStep(4) })
      .catch(() => {})
  }, [status?.active_run, activeRun?.run_id])

  const act = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label)
      setError(null)
      try {
        const result = (await fn()) as { run?: IngestRun }
        if (result?.run) setActiveRun(result.run)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(null)
        refresh()
      }
    },
    [refresh],
  )

  if (loadError && (!status || !config)) {
    return (
      <TabError
        code={loadError.status}
        detail={loadError.message}
        what="The ingestion pipeline's state could not be read from the backend."
        onRetry={refresh}
      />
    )
  }
  if (!status || !config) return <Skeleton className="h-96 w-full" />

  const readable = documents.filter((d) => d.extract_status === 'ok').length
  // One sentence per step saying why it is not reachable yet — a disabled
  // control that does not say why is a dead end with a cursor change.
  const noDocs = readable === 0 ? 'Import a readable document first' : undefined
  const blocked: Record<number, string | undefined> = { 1: undefined, 2: noDocs, 3: noDocs, 4: noDocs }

  return (
    <div className="space-y-4">
      <StepRail steps={STEPS} step={step} setStep={setStep} blocked={blocked} />

      <div>
        <h3 className="text-sm theme-text">{STEPS[step - 1].label}</h3>
        <p className="text-[11px] theme-text-muted">{STEPS[step - 1].hint}</p>
      </div>

      {step === 1 && (
        <ImportStep
          documents={documents}
          extraction={status.extraction}
          onChange={refresh}
          onDelete={(id) => act('delete', () => deleteDocument(id))}
        />
      )}
      {step === 2 && <ChunkStep config={config} documents={documents} onSaved={refresh} />}
      {step === 3 && <EmbeddingStep onOpenForge={onOpenForge} />}
      {step === 4 && (
        <RunStep
          status={status}
          config={config}
          documents={documents}
          activeRun={activeRun}
          busy={busy}
          error={error}
          onAct={act}
          onRefresh={() => {
            if (activeRun) {
              void fetchRun(activeRun.run_id).then((r) => setActiveRun(r.run)).catch(() => {})
            }
            refresh()
          }}
        />
      )}

      <StepFooter steps={STEPS} step={step} setStep={setStep} nextBlocked={blocked[step + 1]} />

    </div>
  )
}
