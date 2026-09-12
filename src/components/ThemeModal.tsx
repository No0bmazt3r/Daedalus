import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ADV_GROUPS,
  ADV_KEYS,
  BASE_KEYS,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  generateHarmonyColors,
  MAX_CUSTOM_THEMES,
  PATTERN_OPTIONS,
  STATIC_PATTERNS,
  THEMES,
  UI_SCALE_OPTIONS,
  type AdvancedKey,
  type BaseKey,
  type DensityKey,
  type FontKey,
  type HarmonyKey,
  type PatternKey,
  type Theme,
  type ThemeColors,
  type UiScale,
} from '../lib/themes'
import { useTheme } from '../contexts/ThemeContext'
import { ColorRow } from './ColorRow'
import {
  Check,
  ChevronRight,
  CircleDashed,
  Download,
  Paintbrush,
  Palette,
  RotateCcw,
  Save,
  Shapes,
  SwatchBook,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { clearZoneHighlight } from '../lib/zoneHighlight'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

interface ThemeModalProps {
  open: boolean
  onClose: () => void
}

const HARMONY_OPTIONS: { value: HarmonyKey; label: string }[] = [
  { value: 'complementary', label: 'Complementary' },
  { value: 'analogous', label: 'Analogous' },
  { value: 'triadic', label: 'Triadic' },
  { value: 'monochromatic', label: 'Monochromatic' },
]

function Card({
  title,
  icon,
  children,
  className = '',
}: {
  title?: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`p-4 rounded-lg border theme-border bg-black/10 ${className}`}>
      {title && (
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          {icon}
          {title}
        </h4>
      )}
      {children}
    </div>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label?: string
  ariaLabel?: string
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      {label && <span className="text-[11px] theme-text-muted">{label}</span>}
      <select
        value={value}
        aria-label={ariaLabel || label}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full bg-black/30 border theme-border rounded px-2 py-1.5 text-xs theme-text focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ backgroundColor: 'var(--card)', color: 'var(--text-main)' }}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '%',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] theme-text-muted">{label}</span>
        <span className="text-[10px] font-mono theme-text-muted tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="theme-range w-full"
      />
    </div>
  )
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <div className="flex -space-x-1.5">
      {colors.map((c, i) => (
        <div
          key={i}
          className="w-5 h-5 rounded-full border border-black/40 shadow-sm"
          style={{ backgroundColor: c, zIndex: i }}
        />
      ))}
    </div>
  )
}

export function ThemeModal({ open, onClose }: ThemeModalProps) {
  const theme = useTheme()
  const {
    state,
    customThemes,
    uiScale,
    savedAt,
    savedLabel,
    referenceColors,
    advancedDefaults,
  } = theme

  const [activeTab, setActiveTab] = useState('themes')
  const [isPeek, setIsPeek] = useState(false)
  const [advOpen, setAdvOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [formError, setFormError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [exported, setExported] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const [harmonyAccent, setHarmonyAccent] = useState(state.colors.primary)
  const [harmonyType, setHarmonyType] = useState<HarmonyKey>('complementary')
  const [harmonyMode, setHarmonyMode] = useState<'dark' | 'light'>('dark')

  const { position, onMouseDown, handleRef, windowRef } = useDraggable()

  // Auto-saved pill, mirroring the flash Odysseus shows on every tweak.
  const [pillVisible, setPillVisible] = useState(false)
  const pillTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!savedAt) return
    setPillVisible(true)
    window.clearTimeout(pillTimer.current)
    pillTimer.current = window.setTimeout(() => setPillVisible(false), 1200)
    return () => window.clearTimeout(pillTimer.current)
  }, [savedAt])

  // Closing clears anything half-finished so the modal reopens clean.
  const handleClose = useCallback(() => {
    setPendingDelete(null)
    setFormError('')
    clearZoneHighlight()
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  const customEntries = useMemo(() => Object.entries(customThemes), [customThemes])

  const harmonyPreview = useMemo(
    () => generateHarmonyColors(harmonyAccent, harmonyType, harmonyMode),
    [harmonyAccent, harmonyType, harmonyMode]
  )

  const slidersDisabled = STATIC_PATTERNS.has(state.pattern)
  const effectColorValue = state.effectColor || state.colors.primary

  if (!open) return null

  const style: React.CSSProperties = {
    ...(position.x !== 0 || position.y !== 0
      ? { top: position.y, left: position.x, right: 'auto', bottom: 'auto' }
      : {}),
    backgroundColor: isPeek
      ? 'color-mix(in srgb, var(--bg, #000) 55%, transparent)'
      : 'var(--bg)',
    backdropFilter: isPeek ? 'none' : undefined,
  }

  const handleSave = () => {
    const result = theme.saveCustomTheme(saveName)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setFormError('')
    setSaveName('')
  }

  const handleExport = () => {
    const json = theme.exportTheme()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daedalus_${state.id || 'theme'}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExported(true)
    window.setTimeout(() => setExported(false), 1500)
  }

  const handleImport = () => {
    const result = theme.importTheme(importText)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setFormError('')
    setImportText('')
    setImportOpen(false)
  }

  const renderThemeButton = (
    id: string,
    name: string,
    colors: ThemeColors,
    isCustom: boolean
  ) => {
    const active = state.id === id
    return (
      <div key={id} className="relative group/swatch">
        <button
          onClick={() => theme.selectTheme(id)}
          className={`w-full flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200 hover:scale-105 ${
            active
              ? 'border-[var(--primary)] bg-black/20 shadow-md'
              : 'border-transparent hover:bg-black/10'
          }`}
        >
          <div className="mb-2">
            <Swatches colors={[colors.bg, colors.sidebar, colors.text, colors.primary]} />
          </div>
          <span className="text-[10px] font-medium opacity-80 truncate max-w-full">
            {name.toLowerCase()}
          </span>
        </button>
        {isCustom && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setPendingDelete(pendingDelete === id ? null : id)
            }}
            title={`Delete theme "${id}"`}
            aria-label={`Delete theme ${id}`}
            className="absolute top-1 right-1 p-0.5 rounded bg-black/40 theme-text-muted opacity-0 group-hover/swatch:opacity-100 hover:theme-text transition-opacity"
          >
            <X size={11} />
          </button>
        )}
        {pendingDelete === id && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl border border-[var(--primary)] bg-black/85 p-1 text-center">
            <span className="text-[9px] theme-text-muted leading-tight">Delete?</span>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  theme.deleteCustomTheme(id)
                  setPendingDelete(null)
                }}
                className="px-1.5 py-0.5 text-[9px] rounded bg-red-500/80 text-white hover:bg-red-500"
              >
                Yes
              </button>
              <button
                onClick={() => setPendingDelete(null)}
                className="px-1.5 py-0.5 text-[9px] rounded bg-white/10 theme-text hover:bg-white/20"
              >
                No
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      <div
        ref={windowRef}
        style={style}
        data-theme-modal
        className={`pointer-events-auto absolute resize ${
          position.x === 0 ? 'top-16 right-16' : ''
        } w-[480px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-6rem)] border theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors duration-300 ${
          isPeek ? 'border-white/20 shadow-none' : ''
        }`}
      >
        {/* Header (drag handle) */}
        <div
          ref={handleRef}
          onMouseDown={onMouseDown}
          className="flex items-center justify-between p-3 border-b theme-border bg-black/20 cursor-move shrink-0"
          style={{ backgroundColor: isPeek ? 'transparent' : undefined }}
        >
          <div className="flex items-center gap-2">
            <Paintbrush size={16} className="theme-primary" />
            <span className="text-sm font-semibold select-none">Theme &amp; Appearance</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setIsPeek(!isPeek)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium border ${
                isPeek
                  ? 'bg-primary/20 text-[var(--primary)] border-[var(--primary)]/30'
                  : 'theme-text-muted hover:theme-text border-transparent hover:bg-black/20'
              }`}
              title="Fade this window to preview the page behind it"
            >
              <CircleDashed
                size={14}
                className={isPeek ? 'animate-[spin_4s_linear_infinite]' : ''}
              />
              Peek
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleClose}
              aria-label="Close theme"
              className="p-1 hover:bg-black/20 rounded theme-text-muted hover:theme-text ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col flex-1 overflow-hidden gap-0"
        >
          <div className="px-4 pt-3 border-b theme-border bg-black/10 shrink-0">
            <TabsList variant="line" className="bg-transparent p-0 h-auto relative flex w-full">
              <TabsTrigger
                value="themes"
                className="flex-1 rounded-none px-2 pb-3 theme-text-muted data-active:text-[var(--primary)] hover:theme-text transition-colors relative z-10"
              >
                <SwatchBook size={14} className="mr-2" /> Themes
              </TabsTrigger>
              <TabsTrigger
                value="customize"
                className="flex-1 rounded-none px-2 pb-3 theme-text-muted data-active:text-[var(--primary)] hover:theme-text transition-colors relative z-10"
              >
                <Paintbrush size={14} className="mr-2" /> Customize
              </TabsTrigger>

              {/* Sliding underline */}
              <div
                className="absolute bottom-0 left-0 h-0.5 w-1/2 theme-bg-primary transition-transform duration-300 ease-in-out"
                style={{
                  transform: activeTab === 'themes' ? 'translateX(0)' : 'translateX(100%)',
                }}
              />
            </TabsList>
          </div>

          {/* ── Themes ─────────────────────────────────────────────── */}
          <TabsContent value="themes" className="flex-1 overflow-y-auto p-4 m-0 min-h-0">
            <h3 className="text-xs font-semibold theme-text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full theme-bg-primary" />
              Default Themes
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {THEMES.map((t: Theme) => renderThemeButton(t.id, t.name, t.colors, false))}
            </div>

            {customEntries.length > 0 && (
              <>
                <h3 className="text-xs font-semibold theme-text-muted uppercase tracking-wider mt-6 mb-4 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full theme-bg-primary" />
                  Your Themes
                  <span className="ml-auto normal-case tracking-normal font-normal opacity-60">
                    {customEntries.length}/{MAX_CUSTOM_THEMES}
                  </span>
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {customEntries.map(([id, entry]) =>
                    renderThemeButton(id, id, entry.colors, true)
                  )}
                </div>
              </>
            )}

            {state.id === 'custom' && (
              <p className="mt-6 text-[11px] theme-text-muted leading-relaxed">
                You have unsaved edits. Give them a name under{' '}
                <button
                  onClick={() => setActiveTab('customize')}
                  className="theme-primary underline underline-offset-2"
                >
                  Customize → Save
                </button>{' '}
                to keep them.
              </p>
            )}
          </TabsContent>

          {/* ── Customize ──────────────────────────────────────────── */}
          <TabsContent value="customize" className="flex-1 overflow-y-auto p-4 m-0 min-h-0 relative">
            <div className="space-y-4">
              {/* Colors */}
              <Card title="Colors" icon={<Palette size={14} className="theme-primary" />}>
                <div className="grid grid-cols-2 gap-x-5 gap-y-0">
                  {BASE_KEYS.map(({ key, label }) => (
                    <ColorRow
                      key={key}
                      label={label}
                      value={state.colors[key as BaseKey]}
                      reference={referenceColors[key as BaseKey]}
                      zone={key}
                      onChange={(hex) => theme.setBaseColor(key as BaseKey, hex)}
                      onReset={() => theme.resetBaseColor(key as BaseKey)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setAdvOpen(!advOpen)}
                  className="mt-3 flex items-center gap-1 text-[11px] theme-text-muted hover:theme-text transition-colors"
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform ${advOpen ? 'rotate-90' : ''}`}
                  />
                  More Colors
                </button>

                {advOpen && (
                  <div className="mt-3 space-y-3 border-t theme-border pt-3">
                    {ADV_GROUPS.map((group) => (
                      <div key={group}>
                        <div className="text-[10px] uppercase tracking-wider theme-text-muted opacity-70 mb-1">
                          {group}
                        </div>
                        {ADV_KEYS.filter((k) => k.group === group).map(({ key, label }) => (
                          <ColorRow
                            key={key}
                            label={label}
                            value={state.advanced?.[key as AdvancedKey] || advancedDefaults[key as AdvancedKey]}
                            reference={advancedDefaults[key as AdvancedKey]}
                            zone={key}
                            onChange={(hex) => theme.setAdvancedColor(key as AdvancedKey, hex)}
                            onReset={() => theme.resetAdvancedColor(key as AdvancedKey)}
                          />
                        ))}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={theme.clearAdvanced}
                      className="w-full py-1.5 text-[11px] rounded border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors"
                    >
                      Clear Advanced Overrides
                    </button>
                  </div>
                )}
              </Card>

              {/* Colour harmony */}
              <Card title="Color Harmony" icon={<Shapes size={14} className="theme-primary" />}>
                <div className="flex items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] theme-text-muted">Accent</span>
                    <label
                      className="relative w-8 h-8 rounded-full border border-black/40 cursor-pointer overflow-hidden"
                      style={{ backgroundColor: harmonyAccent }}
                    >
                      <input
                        type="color"
                        value={harmonyAccent}
                        aria-label="Harmony accent color"
                        onChange={(e) => setHarmonyAccent(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </label>
                  </div>
                  <Select
                    label="Harmony"
                    value={harmonyType}
                    onChange={setHarmonyType}
                    options={HARMONY_OPTIONS}
                  />
                  <Select
                    label="Mode"
                    value={harmonyMode}
                    onChange={(v) => setHarmonyMode(v)}
                    options={[
                      { value: 'dark' as const, label: 'Dark' },
                      { value: 'light' as const, label: 'Light' },
                    ]}
                  />
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex gap-1 flex-1">
                    {[
                      harmonyPreview.bg,
                      harmonyPreview.sidebar,
                      harmonyPreview.card,
                      harmonyPreview.border,
                      harmonyPreview.text,
                      harmonyPreview.primary,
                    ].map((c, i) => (
                      <div
                        key={i}
                        className="h-6 flex-1 rounded border border-black/30"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => theme.applyPalette(harmonyPreview)}
                    className="px-3 py-1.5 text-xs font-medium rounded theme-bg-primary text-black hover:opacity-80 transition-opacity"
                  >
                    Generate
                  </button>
                </div>
              </Card>

              {/* Font & layout */}
              <Card title="Font & Layout" icon={<Type size={14} className="theme-primary" />}>
                <div className="flex gap-3">
                  <Select
                    label="Font"
                    value={state.font}
                    onChange={(v: FontKey) => theme.setFont(v)}
                    options={FONT_OPTIONS}
                  />
                  <Select
                    label="Density"
                    value={state.density}
                    onChange={(v: DensityKey) => theme.setDensity(v)}
                    options={DENSITY_OPTIONS}
                  />
                </div>
                <div className="flex gap-3 mt-3 items-end">
                  <Select
                    label="Text size"
                    value={uiScale}
                    onChange={(v: UiScale) => theme.setUiScale(v)}
                    options={UI_SCALE_OPTIONS}
                  />
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-[11px] theme-text-muted">Frosted glass</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={state.frosted}
                      onClick={() => theme.setFrosted(!state.frosted)}
                      className={`relative w-11 h-6 rounded-full border theme-border transition-colors ${
                        state.frosted ? 'bg-[var(--primary)]' : 'bg-black/30'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                          state.frosted ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </Card>

              {/* Background effect */}
              <Card
                title="Background Effect"
                icon={<CircleDashed size={14} className="theme-primary" />}
              >
                <div className="flex items-end gap-3">
                  <Select
                    label="Effect"
                    value={state.pattern}
                    onChange={(v: PatternKey) => theme.setPattern(v)}
                    options={PATTERN_OPTIONS}
                  />
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] theme-text-muted">Color</span>
                    <div className="flex items-center gap-1">
                      <label
                        className="relative w-8 h-8 rounded-full border border-black/40 cursor-pointer overflow-hidden"
                        style={{ backgroundColor: effectColorValue }}
                      >
                        <input
                          type="color"
                          value={effectColorValue}
                          aria-label="Effect color"
                          onChange={(e) => theme.setEffectColor(e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={theme.resetEffectColor}
                        title="Follow the accent color"
                        aria-label="Reset effect color"
                        className={`p-1 rounded transition-colors ${
                          state.effectColor
                            ? 'theme-primary hover:bg-black/20'
                            : 'theme-text-muted opacity-40'
                        }`}
                      >
                        <RotateCcw size={11} />
                      </button>
                    </div>
                  </div>
                </div>

                {!slidersDisabled && (
                  <div className="flex gap-4 mt-3">
                    <Slider
                      label="Intensity"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(state.effectIntensity * 100)}
                      onChange={(v) => theme.setEffectIntensity(v / 100)}
                    />
                    <Slider
                      label="Size"
                      min={30}
                      max={250}
                      step={10}
                      value={Math.round(state.effectSize * 100)}
                      onChange={(v) => theme.setEffectSize(v / 100)}
                    />
                  </div>
                )}
              </Card>

              {/* Save / share */}
              <Card title="Save & Share" icon={<Save size={14} className="theme-primary" />}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={saveName}
                    maxLength={32}
                    placeholder="Theme name..."
                    onChange={(e) => {
                      setSaveName(e.target.value)
                      setFormError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSave()
                    }}
                    className="flex-1 min-w-0 bg-black/30 border theme-border rounded px-2 py-1.5 text-xs theme-text placeholder:opacity-40 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    className="px-3 py-1.5 text-xs font-medium rounded theme-bg-primary text-black hover:opacity-80 transition-opacity shrink-0"
                  >
                    Save
                  </button>
                </div>

                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setImportOpen(!importOpen)
                      setImportText('')
                      setFormError('')
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] rounded border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors"
                  >
                    <Upload size={11} /> Import
                  </button>
                  <button
                    type="button"
                    onClick={handleExport}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] rounded border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors"
                  >
                    {exported ? <Check size={11} /> : <Download size={11} />}
                    {exported ? 'Downloaded' : 'Export'}
                  </button>
                </div>

                {importOpen && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      rows={4}
                      value={importText}
                      placeholder="Paste theme JSON here..."
                      onChange={(e) => setImportText(e.target.value)}
                      className="w-full bg-black/30 border theme-border rounded px-2 py-1.5 text-[11px] font-mono theme-text placeholder:opacity-40 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleImport}
                        className="flex-1 py-1.5 text-[11px] rounded theme-bg-primary text-black hover:opacity-80 transition-opacity"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setImportOpen(false)
                          setImportText('')
                          setFormError('')
                        }}
                        className="flex-1 py-1.5 text-[11px] rounded border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {formError && (
                  <p className="mt-2 text-[11px] text-red-400" role="alert">
                    {formError}
                  </p>
                )}
              </Card>

              <button
                type="button"
                onClick={theme.resetToDefault}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors"
              >
                <RotateCcw size={12} /> Reset to Default
              </button>
            </div>

            {/* Auto-saved pill */}
            <div
              className={`sticky bottom-0 float-right -mt-8 mr-1 flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-black/70 theme-primary border border-[var(--primary)]/30 pointer-events-none transition-opacity duration-200 ${
                pillVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <Check size={10} />
              {savedLabel}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
