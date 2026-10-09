import { Cloud } from 'lucide-react'
import { Switch } from '../ui/switch'
import { useSettings } from '../../contexts/SettingsContext'

/**
 * Settings → Cloud Models: one switch for whether hosted models exist in this
 * console at all. Off hides them from the composer and the Forge, and the
 * backend refuses a request naming one, so a stale selection cannot slip one
 * through.
 */
export function CloudModelsPanel(_props: { isPeek?: boolean }) {
  const { cloudEnabled, setCloudEnabled } = useSettings()
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <section className="space-y-2 rounded-lg border theme-border p-4">
        <div className="flex items-center justify-between gap-4">
          <h4 className="flex items-center gap-1.5 text-sm theme-text">
            <Cloud size={14} className="theme-text-muted" /> Allow cloud models
          </h4>
          <Switch checked={cloudEnabled} onChange={setCloudEnabled} label="Allow cloud models" />
        </div>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          Cloud models are Ollama's hosted <code>-cloud</code> tags and the benchmark endpoints you
          add. They send your question off this machine, so they are evaluation baselines and are
          logged separately. Turn this off and they disappear from the model picker and the Forge,
          and any request that still names one is answered by your local model instead.
        </p>
        {!cloudEnabled && (
          <p className="text-[11px] theme-text-muted">
            Your saved endpoints and keys are kept. Turning this back on brings them back.
          </p>
        )}
      </section>
    </div>
  )
}
