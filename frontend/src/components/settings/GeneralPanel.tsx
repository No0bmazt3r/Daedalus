import { useState } from 'react'
import { Cloud, ShieldCheck } from 'lucide-react'
import { Switch } from '../ui/switch'
import { useSettings } from '../../contexts/SettingsContext'
import { setToolMode, type ToolMode } from '../../lib/toolsClient'
import { ModeSwitch } from './AgentToolsPanel'

/**
 * Settings → General: app-wide features you switch on or off. One row per
 * feature, so a new switch is one more `<Feature>` rather than a new panel.
 *
 * The mode comes first because it decides the rest. Simple is the local-only,
 * answering-only setup the evaluation runs in; the backend enforces it
 * (`tool_policy_store.is_simple`), so this is a switch, not a promise.
 */
export function GeneralPanel(_props: { isPeek?: boolean }) {
  const { cloudSwitch, setCloudEnabled, appMode } = useSettings()
  const mode: ToolMode = appMode ?? 'simple'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changeMode = async (next: ToolMode) => {
    setBusy(true)
    setError(null)
    try {
      await setToolMode(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not change the mode')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <section className="rounded-lg border theme-border divide-y divide-[color:var(--border)]">
        <Feature
          icon={ShieldCheck}
          title="Mode"
          hint="Simple: local only. Answers come from the model on this machine using the sensor tools and the selected retrieval track; cloud models, web search, MCP servers and the extra agent tools are off, and their settings are hidden. Advanced: everything, under the switches below and in Agent Tools. Downloading a model in the Forge still needs the network in either mode."
          control={<ModeSwitch mode={mode} onChange={(m) => void changeMode(m)} busy={busy || appMode === null} />}
          error={error}
        />
        {/* Off is enforced by the backend too (`model_config.cloud_allowed`). */}
        <Feature
          icon={Cloud}
          title="Cloud models"
          hint={mode === 'simple'
            ? 'Off in Simple mode. Switch to Advanced to use cloud models as evaluation baselines.'
            : "Ollama's hosted -cloud tags and the benchmark endpoints you add. They send your question off this machine, so they're evaluation baselines and are logged separately. Off: they disappear from the model picker and the Forge, and a request that still names one is answered by your local model. Saved endpoints and keys are kept."}
          control={
            <Switch
              checked={mode === 'simple' ? false : cloudSwitch}
              onChange={setCloudEnabled}
              disabled={mode === 'simple'}
              label="Cloud models"
            />
          }
          muted={mode === 'simple'}
        />
      </section>
    </div>
  )
}

function Feature({
  icon: Icon, title, hint, control, error, muted,
}: {
  icon: typeof Cloud
  title: string
  hint: string
  control: React.ReactNode
  error?: string | null
  muted?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-4 p-4 ${muted ? 'opacity-70' : ''}`}>
      <div className="min-w-0">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <Icon size={14} className="theme-text-muted" /> {title}
        </h4>
        <p className="mt-1 text-[11px] leading-relaxed theme-text-muted">{hint}</p>
        {error && <p role="alert" className="mt-1 text-[11px] status-bad">{error}</p>}
      </div>
      {control}
    </div>
  )
}
