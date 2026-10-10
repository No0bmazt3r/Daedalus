import { useCallback, useEffect, useState } from 'react'
import { type ModelRow } from '../../../lib/forgeClient'
import { loadOnePref, savePref, PREF_FORGE_SHORTLIST } from '../../../lib/prefsClient'

/**
 * One model, with its quantisations inside it.
 *
 * The table arrives one row per model × quantisation, which is the right shape
 * for the scorer and the wrong one for a reader: the old list showed Gemma 3 1B
 * three times and counted the shortlist as fifteen when it holds six. So rows
 * are grouped by `model_id`, and the quantisation is a choice made on the card.
 */
export interface ModelGroup {
  model_id: string
  /** Every variant, best-ranked first — the order the table already sorted. */
  variants: ModelRow[]
  /** One of the six PROJECT.md §8.1 names. Fixed: the report argues about these. */
  reportCandidate: boolean
  installed: boolean
  /** Only catalogue and on-disk models can be starred; a search hit has no stable home. */
  starrable: boolean
}

export function groupRows(rows: ModelRow[], starrable: boolean): ModelGroup[] {
  const byId = new Map<string, ModelGroup>()
  for (const row of rows) {
    let group = byId.get(row.model_id)
    if (!group) {
      group = { model_id: row.model_id, variants: [], reportCandidate: false, installed: false, starrable }
      byId.set(row.model_id, group)
    }
    group.variants.push(row)
    group.reportCandidate ||= row.shortlist
    group.installed ||= row.installed
  }
  return [...byId.values()]
}

/**
 * The shortlist is yours to edit, but stored as edits against the report's six
 * rather than as a list of its own. A catalogue that later adds a seventh
 * candidate then reaches everyone who has not removed it, and "what did you
 * change?" has an answer.
 */
interface ShortlistPref {
  added: string[]
  removed: string[]
}

function isShortlistPref(v: unknown): v is ShortlistPref {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.added) && Array.isArray(o.removed)
}

export function useShortlist() {
  const [pref, setPref] = useState<ShortlistPref>({ added: [], removed: [] })

  useEffect(() => {
    loadOnePref(PREF_FORGE_SHORTLIST)
      .then((v) => { if (isShortlistPref(v)) setPref(v) })
      .catch(() => undefined)
  }, [])

  const starred = useCallback(
    (g: ModelGroup) =>
      (g.reportCandidate && !pref.removed.includes(g.model_id)) || pref.added.includes(g.model_id),
    [pref],
  )

  const toggle = useCallback((g: ModelGroup) => {
    setPref((prev) => {
      const id = g.model_id
      const on = (g.reportCandidate && !prev.removed.includes(id)) || prev.added.includes(id)
      const next: ShortlistPref = g.reportCandidate
        ? {
            added: prev.added.filter((x) => x !== id),
            removed: on ? [...prev.removed, id] : prev.removed.filter((x) => x !== id),
          }
        : {
            added: on ? prev.added.filter((x) => x !== id) : [...prev.added, id],
            removed: prev.removed.filter((x) => x !== id),
          }
      savePref(PREF_FORGE_SHORTLIST, next)
      return next
    })
  }, [])

  return { starred, toggle }
}
