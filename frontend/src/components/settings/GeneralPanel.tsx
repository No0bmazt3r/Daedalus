import { Cloud } from 'lucide-react'
import { Switch } from '../ui/switch'
import { useSettings } from '../../contexts/SettingsContext'

/**
 * Settings → General: app-wide features you switch on or off. One row per
 * feature, so a new switch is one more `<Feature>` rather than a new panel.
 */
export function GeneralPanel(_props: { isPeek?: boolean }) {
  const { cloudEnabled, setCloudEnabled } = useSettings()
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <section className="rounded-lg border theme-border">
        {/* Off is enforced by the backend too (`model_config.cloud_allowed`). */}
        <Feature
          icon={Cloud}
          title="Cloud models"
          checked={cloudEnabled}
          onChange={setCloudEnabled}
          hint="Ollama's hosted -cloud tags and the benchmark endpoints you add. They send your question off this machine, so they're evaluation baselines and are logged separately. Off: they disappear from the model picker and the Forge, and a request that still names one is answered by your local model. Saved endpoints and keys are kept."
        />
      </section>
    </div>
  )
}

function Feature({
  icon: Icon, title, hint, checked, onChange,
}: {
  icon: typeof Cloud
  title: string
  hint: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <Icon size={14} className="theme-text-muted" /> {title}
        </h4>
        <p className="mt-1 text-[11px] leading-relaxed theme-text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}
