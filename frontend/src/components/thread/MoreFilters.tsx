import { type TraceStatus } from '../../lib/threadClient'
import { NO_EXTRA, type Extra } from '../../lib/threadLogic'
import { ThemeSelect } from '../ui/theme-select'
import { DatePicker } from '../ui/date-picker'
import { STATUS } from './status'

/** Track, model, label and dates — folded away until wanted. */
export function MoreFilters({ value, onChange, models }: { value: Extra; onChange: (v: Extra) => void; models: string[] }) {
  // One filter per row, its name beside it: the column is narrow, and two
  // dropdowns to a row cut both their values and their menus down to "Labe…".
  const row = (label: string, control: React.ReactNode) => (
    <div className="grid grid-cols-[3.75rem_1fr] items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider theme-text-muted">{label}</span>
      <div className="min-w-0">{control}</div>
    </div>
  )
  const active = JSON.stringify(value) !== JSON.stringify(NO_EXTRA)
  return (
    <div className="space-y-2 rounded-lg border theme-border theme-card p-3">
      {/* The six outcomes each by name — finer than the three buckets above the list. */}
      {row('Outcome', (
        <ThemeSelect
          size="sm"
          ariaLabel="Outcome"
          className="w-full"
          value={value.status || 'any'}
          onChange={(v) => onChange({ ...value, status: v === 'any' ? '' : (v as TraceStatus) })}
          options={[
            { value: 'any', label: 'Any outcome' },
            ...(Object.keys(STATUS) as TraceStatus[]).map((st) => ({ value: st, label: STATUS[st].label })),
          ]}
        />
      ))}
      {row('Track', (
        <ThemeSelect
          size="sm"
          ariaLabel="Track"
          className="w-full"
          value={value.track || 'any'}
          onChange={(v) => onChange({ ...value, track: v === 'any' ? '' : (v as Extra['track']) })}
          options={[{ value: 'any', label: 'Any track' }, { value: 'vector', label: 'Vector RAG' }, { value: 'graph', label: 'Graph RAG' }]}
        />
      ))}
      {row('Label', (
        <ThemeSelect
          size="sm"
          ariaLabel="Label"
          className="w-full"
          value={value.labelled || 'any'}
          onChange={(v) => onChange({ ...value, labelled: v === 'any' ? '' : (v as Extra['labelled']) })}
          options={[{ value: 'any', label: 'Any label' }, { value: 'yes', label: 'Labelled' }, { value: 'no', label: 'Unlabelled' }]}
        />
      ))}
      {row('Model', (
        <ThemeSelect
          size="sm"
          ariaLabel="Model"
          className="w-full"
          value={value.model || 'any'}
          onChange={(v) => onChange({ ...value, model: v === 'any' ? '' : v })}
          options={[{ value: 'any', label: 'Any model' }, ...models.map((m) => ({ value: m, label: m }))]}
        />
      ))}
      {row('From', <DatePicker ariaLabel="From" value={value.since} max={value.until || undefined} onChange={(v) => onChange({ ...value, since: v })} />)}
      {row('To', <DatePicker ariaLabel="To" value={value.until} min={value.since || undefined} onChange={(v) => onChange({ ...value, until: v })} />)}
      {active && (
        <button onClick={() => onChange(NO_EXTRA)} className="w-full pt-1 text-right text-[10px] theme-text-muted hover:theme-text">
          Clear these filters
        </button>
      )}
    </div>
  )
}
