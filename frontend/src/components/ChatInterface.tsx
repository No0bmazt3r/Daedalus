import { LabyrinthIcon } from "./LabyrinthIcon";
import { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { MINIMIZED_DOCK_SLOT } from './ui/floating-window'
import { Textarea } from './ui/textarea'
import { ScrollArea } from './ui/scroll-area'
import { Plus, Mic, ArrowUp, Zap, Ghost, ChevronDown, Copy, GitFork, RefreshCw, Check, Cloud } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip'
import { 
  DropdownMenu, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from './ui/dropdown-menu'

import { CapabilityBadges } from './ui/capability-badges'
import { useSettings } from '../contexts/SettingsContext'
import { useUiPrefs } from '../contexts/UiPrefsContext'
import { FOCUS_COMPOSER_EVENT } from '../lib/keybinds'
import { useSessions } from '../contexts/SessionsContext'

function TypewriterText({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState('')
  
  useEffect(() => {
    setDisplayedText('')
    let i = 0
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        setDisplayedText(text.slice(0, i + 1))
        i++
        if (i >= text.length) clearInterval(interval)
      }, 40)
      return () => clearInterval(interval)
    }, 100)
    return () => clearTimeout(timeout)
  }, [text])

  return (
    <span className="inline-flex items-center">
      {displayedText}
      <span className="animate-[pulse_1s_ease-in-out_infinite] inline-block w-[3px] h-[0.9em] bg-current ml-1 rounded-sm opacity-70"></span>
    </span>
  )
}

function MessageActions({ text, modelTag, fromCloud }: { text: string, modelTag?: string, fromCloud?: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="p-1.5 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
        title="Copy"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {/* Not wired up yet. Disabled rather than inert: a button that quietly
          does nothing reads as a bug, and these are the shape the branching
          work in MODULES.md will fill in. */}
      <button
        disabled
        className="p-1.5 rounded-md theme-text-muted opacity-40 cursor-not-allowed"
        title="Fork conversation from this point — not available yet"
      >
        <GitFork size={14} />
      </button>
      <button
        disabled
        className="p-1.5 rounded-md theme-text-muted opacity-40 cursor-not-allowed"
        title="Rerun prompt — not available yet"
      >
        <RefreshCw size={14} />
      </button>
      {modelTag && (
        <span
          className={`text-[11px] ml-1 select-none flex items-center gap-1 ${
            fromCloud ? 'status-warn' : 'theme-text-muted'
          }`}
          title={fromCloud ? 'Answered off this machine — logged as chat_cloud' : undefined}
        >
          {fromCloud && <Cloud size={10} />}
          {modelTag}
        </span>
      )}
    </div>
  )
}

/**
 * Everything under the textarea: attach, mode, model picker, mic, send.
 *
 * One component for both composers. They were separate blocks, and the
 * in-conversation one had drifted down to just attach-and-send — so once a
 * chat had started there was no way to change model without opening a new one.
 * That is the wrong default for a multi-model system: comparing a local answer
 * against a cloud one is most useful *within* one conversation, and `model_tag`
 * is already recorded per message, so a mixed transcript is a shape the store
 * has always supported.
 */
function ComposerControls({
  onSend,
  canSend,
  compact = false,
}: {
  onSend: () => void
  canSend: boolean
  /** The in-conversation composer sits tighter than the greeting one. */
  compact?: boolean
}) {
  const {
    selectedModel, setSelectedModel, models, referenceModels,
    modelsLoading, modelsError, deployedModel,
  } = useSettings()

  let modelOptions: { value: string; label: string; capabilities?: string[] }[] =
    [{ value: '', label: 'Loading models…' }]
  if (!modelsLoading) {
    if (modelsError) {
      modelOptions = [{ value: '', label: modelsError }]
    } else if (models.length > 0) {
      modelOptions = models.map(m => ({ value: m.name, label: m.name, capabilities: m.capabilities }))
    } else {
      modelOptions = [{ value: '', label: 'No local models — pull one in The Forge' }]
    }
  }

  // Which of the two halves the current pick came from. The composer says so
  // before you send, not only afterwards in the transcript.
  const selectedIsCloud = referenceModels.some((m) => m.name === selectedModel)

  return (
      <div className={`flex items-center justify-between px-3 pt-1 ${compact ? 'pb-2' : 'pb-3'}`}>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]">
            <Plus size={18} />
          </Button>
          <div className="flex items-center rounded-lg p-0.5 border theme-border bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]">
            <button className="px-3 py-1 text-xs font-medium rounded-md shadow-sm theme-text bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] transition-colors duration-200">Chat</button>
            <button className="px-3 py-1 text-xs font-medium theme-text-muted hover:theme-text transition-colors duration-200">System</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center text-xs theme-text-muted mr-2 cursor-pointer hover:theme-text outline-none data-[state=open]:theme-text">
              {selectedIsCloud
                ? <Cloud size={14} className="mr-1 status-warn" />
                : <Zap size={14} className="mr-1 theme-accent" />}
              {selectedModel}
              <ChevronDown size={14} className="ml-1 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 z-50 theme-card theme-border theme-text border">
              {modelOptions.map(opt => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => { if (opt.value) setSelectedModel(opt.value) }}
                  disabled={!opt.value}
                  className={`cursor-pointer flex items-center gap-2 ${
                    selectedModel === opt.value
                      ? 'theme-accent bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]'
                      : 'theme-text-muted'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  <CapabilityBadges capabilities={opt.capabilities} />
                  {deployedModel?.tag === opt.value && (
                    <span
                      className="ml-auto text-[10px] theme-text-muted uppercase tracking-wide shrink-0"
                      title={deployedModel.reason}
                    >
                      {deployedModel.mode}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}

              {/* Selectable, under their own heading and their own
                  warning. Rule 1 is recorded rather than prevented here:
                  the turn is logged `chat_cloud` and the transcript marks
                  it, so the production figures stay clean while the
                  comparison stays inside the system where it is logged. */}
              {referenceModels.length > 0 && (
                <>
                  <DropdownMenuSeparator className="theme-border" />
                  {/* Label and rows inside a Group: Base UI's GroupLabel
                      reads its context and throws without one. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide status-warn font-normal">
                      Evaluation only · not Rule&nbsp;1 safe
                    </DropdownMenuLabel>
                    {referenceModels.map(m => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => setSelectedModel(m.name)}
                        title={m.note ?? undefined}
                        className={`cursor-pointer flex items-center gap-2 ${
                          selectedModel === m.name
                            ? 'status-warn bg-[color-mix(in_srgb,var(--status-warn)_16%,transparent)]'
                            : 'theme-text-muted'
                        }`}
                      >
                        <Cloud size={12} className="shrink-0" />
                        <span className="truncate">{m.name}</span>
                        <CapabilityBadges capabilities={m.capabilities} />
                        <span className="ml-auto text-[10px] theme-text-muted uppercase tracking-wide shrink-0">
                          cloud
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]">
            <Mic size={18} />
          </Button>
          <Button
            onClick={onSend}
            disabled={!canSend}
            className="w-8 h-8 rounded-full theme-bg-primary zone-send-btn hover: theme-text-on-primary disabled:opacity-40 disabled:theme-track disabled:theme-text-muted p-0"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </Button>
        </div>
      </div>
  )
}

export function ChatInterface() {
  // The picker lives in ComposerControls now; only `referenceModels` is needed
  // here, to mark which transcript turns came from off the machine.
  const { isIncognito, setIsIncognito, referenceModels } = useSettings()
  // The transcript lives on the server — see contexts/SessionsContext.
  const { messages, sendMessage, sending, error, modelNotice } = useSessions()
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { show } = useUiPrefs()

  // Settings → Appearance. `chat-fullwidth` is the one that is off by default:
  // a measured column is easier to read, and the full window is the choice you
  // make when a transcript is full of tables.
  const columnWidth = show('chat-fullwidth') ? 'w-full' : 'max-w-3xl mx-auto w-full'

  // The composer is focused by shortcut from the root, which cannot reach this
  // ref. See `lib/keybinds.ts` for why this is an event rather than a ref
  // threaded up through two contexts.
  useEffect(() => {
    const onFocus = () => textareaRef.current?.focus()
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocus)
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocus)
  }, [])
  

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim() || sending) return
    const content = input
    setInput('')
    void sendMessage(content)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // No background of its own: <main> paints the theme colour beneath the
  // background-effect canvas, so an opaque layer here would hide the effect.
  return (
    <div className="flex-1 flex flex-col theme-text relative w-full h-full transition-colors duration-200">
    <TooltipProvider delay={200}>
      <div className="absolute top-4 right-6 flex items-center gap-3 z-50">
        {/* Minimized windows land here, to the left of the incognito toggle.
            `FloatingWindow` portals into this node by id; see `getDock` there.
            An existing, always-visible control cluster beats a floating bar:
            bottom-centre sat directly under the composer, which is the one
            place guaranteed to compete for attention while you are typing. */}
        <div
          id={MINIMIZED_DOCK_SLOT}
          className="flex flex-wrap items-center justify-end gap-2 max-w-[min(60vw,640px)]"
        />
        {/* Hideable, but the mode is not: the shortcut and Settings → Shortcuts
            both still toggle it, and the composer still says so in its
            placeholder. A hidden control is one click fewer, never a silently
            different state. */}
        {show('chat-incognito') && (
        <Tooltip>
          <TooltipTrigger 
            render={
              <Button 
                variant="ghost" 
                size="icon" 
                className={`w-9 h-9 rounded-full transition-all duration-300 ${
                  isIncognito 
                    ? 'incognito-text incognito-bg-soft incognito-glow scale-110' 
                    : 'theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]'
                }`}
                onClick={() => setIsIncognito(!isIncognito)}
              />
            }
          >
            <Ghost size={18} className={isIncognito ? "animate-pulse" : ""} />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={5}>
            {isIncognito ? "Disable Incognito Mode" : "Enable Incognito Mode"}
          </TooltipContent>
        </Tooltip>
        )}
      </div>
      {messages.length === 0 ? (
        <div className={`flex-1 flex flex-col items-center justify-center px-4 ${columnWidth}`}>
          {show('chat-welcome') && (
          <div className="flex items-center gap-3 mb-8">
            <LabyrinthIcon className={`w-10 h-10 transition-colors duration-300 ${isIncognito ? 'incognito-text incognito-drop-glow' : 'theme-accent'}`} />
            <h1 className={`text-3xl font-serif tracking-tight transition-colors duration-300 ${isIncognito ? 'incognito-text' : ''}`}>
              <TypewriterText
                text={isIncognito ? 'Off the record, Operator' : 'Good afternoon, Operator'}
              />
            </h1>
          </div>
          )}
          
          {/* The greeting view previously rendered no error, so a failed first
              message vanished without explanation. Anything that stops a send
              has to be visible from wherever the send was made. */}
          {(error || modelNotice) && (
            <div className="w-full mb-2 text-[13px] status-warn px-1">
              {error || modelNotice}
            </div>
          )}
          <div className="w-full theme-card zone-input border theme-border rounded-2xl flex flex-col shadow-sm focus-within:ring-1 focus-within:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)] transition-all">
            <Textarea 
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isIncognito ? "Incognito mode active. How can I help?" : "How can I help you today?"}
              className={`bg-transparent border-0 resize-none focus-visible:ring-0 px-4 py-4 min-h-[56px] max-h-[200px] overflow-y-auto text-base placeholder:opacity-50 transition-colors ${isIncognito ? 'incognito-placeholder' : ''}`}
              rows={1}
            />
            
            <ComposerControls onSend={handleSend} canSend={!!input.trim() && !sending} />
          </div>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 w-full">
            {/* pt-20 clears the control cluster pinned at top-4: the incognito
                toggle is always there, and minimized-window chips sit beside
                it, so the first message has to start below both. */}
            <div className={`flex flex-col pt-20 px-4 gap-6 pb-32 ${columnWidth}`}>
              {messages.map((msg) => (
                <div key={msg.key} className={`flex w-full group ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 mr-4 shrink-0 rounded-md flex items-center justify-center border theme-border theme-card zone-ai-bubble">
                      <LabyrinthIcon className="w-5 h-5 zone-brand" />
                    </div>
                  )}
                  <div
                    className={`text-[15px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'theme-sidebar zone-user-bubble border px-5 py-3 rounded-2xl max-w-[80%]'
                        : 'max-w-[85%] pt-1'
                    } ${msg.failed ? 'status-bad-border' : ''}`}
                  >
                    {msg.role === 'assistant' && msg.content === '' && !msg.persisted ? (
                      <span className="theme-text-muted animate-pulse">Thinking…</span>
                    ) : (
                      msg.content
                    )}

                    {msg.role === 'assistant' && msg.persisted && msg.content !== '' && (
                      <MessageActions
                        text={msg.content}
                        modelTag={msg.modelTag}
                        // Resolved against the live list rather than stored on
                        // the turn: a tag's locality is a property of the
                        // machine, and it can change under a saved transcript.
                        fromCloud={referenceModels.some((m) => m.name === msg.modelTag)}
                      />
                    )}

                    {/* A failed send is kept on screen so the text is not lost,
                        and labelled so it is not mistaken for one that landed. */}
                    {msg.failed && (
                      <div className="mt-1.5 text-[11px] status-warn">
                        Not sent. {error}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {modelNotice && (
                <div className="text-[13px] status-warn px-1">{modelNotice}</div>
              )}
              {/* Suppressed when a bubble already carries it: a failed message
                  labels itself "Not sent. <reason>", and repeating the reason
                  underneath reads as two separate problems. */}
              {error && !messages.some((m) => m.failed) && (
                <div className="text-[13px] status-warn px-1">{error}</div>
              )}
            </div>
          </ScrollArea>
          
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className={columnWidth}>
              <div className="w-full theme-card zone-input border theme-border rounded-2xl flex flex-col shadow-lg focus-within:ring-1 focus-within:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)] transition-all">
                <Textarea 
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isIncognito ? "Incognito mode active. How can I help?" : "How can I help you today?"}
                  className={`bg-transparent border-0 resize-none focus-visible:ring-0 px-4 py-3 min-h-[44px] max-h-[200px] overflow-y-auto text-base placeholder:opacity-50 transition-colors ${isIncognito ? 'incognito-placeholder' : ''}`}
                  rows={1}
                />
                
                <ComposerControls
                  onSend={handleSend}
                  canSend={!!input.trim() && !sending}
                  compact
                />
              </div>
            </div>
          </div>
        </>
      )}
    </TooltipProvider>
    </div>
  )
}
