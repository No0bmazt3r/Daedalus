import type { ModelArch } from '../../lib/forgeClient'

/**
 * The shape of a pulled model, as read from its GGUF header.
 *
 * Shared by the Forge's model table and the model manager so the two never
 * disagree about what a tag is, in the same way `CapabilityBadges` is shared
 * with the composer's picker.
 *
 * Two screens, two reasons to show it:
 *
 * - In the Forge it sits under the memory estimate, because it *is* the
 *   estimate's inputs — the KV-cache term is `layers × kv_heads × head_dim`
 *   arithmetic, and `MODULES.md` §2.2 is about a reader being able to check a
 *   number rather than trust it.
 * - In the manager the estimate is over and done with; what is left is the
 *   description of the file actually on this disk.
 *
 * Absent before a model is pulled, and rendered as nothing rather than as
 * dashes: there is no architecture to report for a file that is not here.
 *
 * `hidden size` is the one field that gets misread, because it comes from the
 * same GGUF key as an embedding model's output width and means something
 * different. Its hint says so on both screens — a chat model's 2048 is not
 * comparable to nomic-embed's 768, and neither is `head dim`, which is only
 * this model's attention geometry.
 */
export function ModelArchitecture({ arch }: { arch?: ModelArch | null }) {
  if (!arch || !arch.layers) return null

  const facts: [string, string, string?][] = [
    ['layers', String(arch.layers), 'Transformer blocks. The KV cache scales linearly with this.'],
    [
      'attn heads',
      arch.heads ? String(arch.heads) : '—',
      'Query heads per block. heads x head_dim is the hidden size.',
    ],
    [
      'KV heads',
      arch.kv_heads ? String(arch.kv_heads) : '—',
      'Fewer than attention heads means grouped-query attention, which is what makes the KV cache affordable.',
    ],
    [
      'head dim',
      arch.head_dim ? String(arch.head_dim) : '—',
      'The width of one attention head. Internal to the model — not a retrieval vector width.',
    ],
    [
      'hidden size',
      arch.embedding_length ? String(arch.embedding_length) : '—',
      "The model's internal width. Not a retrieval vector width — an embedding model's dimensions are a different quantity that happens to share a GGUF key.",
    ],
  ]

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wide theme-text-muted">architecture</span>
        <span
          title={
            arch.measured
              ? 'Read from the pulled file.'
              : 'Partly inferred: this family did not publish every field, so head_dim or kv_heads were derived from the standard relations.'
          }
          className={`text-[9px] uppercase tracking-wide ${arch.measured ? 'status-ok' : 'theme-text-muted opacity-70'}`}
        >
          {arch.measured ? 'measured' : 'partly inferred'}
        </span>
      </div>
      <div className="grid grid-cols-3 @lg:grid-cols-5 gap-x-4 gap-y-1.5">
        {facts.map(([label, value, hint]) => (
          <div key={label} className="min-w-0" title={hint}>
            <div className="text-[10px] uppercase tracking-wide theme-text-muted">{label}</div>
            <div className="text-xs font-mono theme-text">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
