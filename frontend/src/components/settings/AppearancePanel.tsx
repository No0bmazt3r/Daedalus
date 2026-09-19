import { Palette, RotateCcw } from 'lucide-react'
import { Switch } from '../ui/switch'
import { useUiPrefs } from '../../contexts/UiPrefsContext'
import { CHROME_SECTIONS, sectionChangedCount } from '../../lib/uiChrome'

/**
 * Settings → Appearance.
 *
 * Two halves, deliberately unequal. This panel owns what is *on screen* — the
 * furniture, one switch per piece, ported from Odysseus' appearance column. What
 * things *look like* stays in the Theme window, because colours and fonts are
 * chosen against the live app and a modal that covers it is the wrong place to
 * judge them. The link below says so rather than duplicating the controls, which
 * is how two screens end up disagreeing about the current font.
 *
 * Nothing here can hide an answer, a citation, a refusal or a warning. Every
 * switch costs a click at worst — see the note in `lib/uiChrome.ts`.
 */
export function AppearancePanel({
  isPeek,
  onOpenTheme,
}: {
  isPeek: boolean
  onOpenTheme?: () => void
}) {
  const { chrome, setChrome, resetChromeSection, resetAllChrome } = useUiPrefs()

  const card = `p-4 rounded-xl border theme-border transition-colors ${
    isPeek ? 'bg-transparent' : 'theme-surface'
  }`

  const changed = CHROME_SECTIONS.reduce((n, s) => n + sectionChangedCount(s, chrome), 0)

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Appearance</h3>
        <p className="text-sm theme-text-muted">
          Which parts of the interface are drawn. Hiding one never hides an answer or a
          warning — only navigation and decoration are switchable.
        </p>
        {changed > 0 && (
          <p className="flex items-center gap-2 text-xs theme-text-muted mt-1.5">
            {changed} changed from the default.
            <button
              onClick={resetAllChrome}
              className="underline underline-offset-2 hover:theme-text transition-colors"
            >
              reset all
            </button>
          </p>
        )}
      </div>

      <div className={`${card} flex items-center gap-3`}>
        <Palette size={16} className="theme-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm">Colours, font and background effect</div>
          <div className="text-xs theme-text-muted">
            In their own window, so you judge them against the live app rather than
            through a modal covering it.
          </div>
        </div>
        {onOpenTheme && (
          <button
            onClick={onOpenTheme}
            className="shrink-0 px-2.5 py-1 rounded-lg border theme-border text-[11px] theme-text-muted hover:theme-text transition-colors"
          >
            Open Theme
          </button>
        )}
      </div>

      {CHROME_SECTIONS.map((section) => {
        const sectionChanged = sectionChangedCount(section, chrome)
        return (
          <div key={section.id}>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-xs font-medium theme-text">{section.label}</h4>
              <span className="text-[10px] theme-text-muted flex-1">
                {sectionChanged === 0
                  ? 'as it ships'
                  : `${sectionChanged} changed`}
              </span>
              <button
                onClick={() => resetChromeSection(section)}
                disabled={sectionChanged === 0}
                title={`Reset ${section.label} to what the app ships with`}
                aria-label={`Reset ${section.label}`}
                className="p-1 rounded-md theme-text-muted hover:theme-text disabled:opacity-0 transition-colors"
              >
                <RotateCcw size={12} />
              </button>
            </div>

            <div className="rounded-xl border theme-border px-3">
              {section.toggles.map((toggle) => (
                <div
                  key={toggle.key}
                  className="flex items-center gap-3 py-2 border-b theme-border last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs theme-text truncate">{toggle.label}</div>
                    <div className="text-[10px] theme-text-muted truncate">{toggle.hint}</div>
                  </div>
                  <div className="shrink-0 scale-[0.72] origin-right">
                    <Switch
                      checked={chrome[toggle.key]}
                      onChange={(next) => setChrome(toggle.key, next)}
                      label={`${toggle.label} — shown or hidden`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
