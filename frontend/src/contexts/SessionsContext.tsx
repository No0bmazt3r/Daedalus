import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  createSession,
  deleteSession as apiDeleteSession,
  getMessages,
  listSessions,
  renameSession as apiRenameSession,
  SessionApiError,
  type ChatMessage,
  type ChatSession,
} from '../lib/sessionsClient';
import { useSettings } from './SettingsContext';
import { sendChat, checkChatStatus } from '../lib/chatClient';

/**
 * Conversation state for the whole app.
 *
 * The server owns the transcript; this context is a cache of it plus the
 * small amount of state that is genuinely client-side (which chat is open,
 * and whether a request is in flight).
 *
 * ## A new chat is not created until it is used
 *
 * Pressing "New" clears the active session rather than POSTing one. A session
 * only exists once the first message is sent. Otherwise every stray click
 * would leave an empty untitled row in the sidebar forever.
 */

export interface DisplayMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  /** False for an optimistic echo the backend has not confirmed. */
  persisted: boolean;
  /** The send failed. The text is still yours; it just never reached the server. */
  failed?: boolean;
  /** The tag of the model that generated this message, if known. */
  modelTag?: string;
}

export type SessionsStatus = 'loading' | 'ready' | 'offline';

interface SessionsContextValue {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: DisplayMessage[];
  status: SessionsStatus;
  error: string | null;
  sending: boolean;
  newChat: () => void;
  selectSession: (id: string) => void;
  sendMessage: (content: string) => Promise<void>;
  /** Set when the server answered with a different model than was asked for. */
  modelNotice: string | null;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

// A module-level constant, so hiding the transcript does not hand out a fresh
// array identity on every render and defeat the memo below.
const NO_MESSAGES: DisplayMessage[] = [];

// How often a reopened chat asks whether its in-flight answer has landed. Slow
// enough not to hammer the API, fast enough that the answer does not feel stuck
// after the generation has actually finished.
const RECONNECT_POLL_MS = 2000;

function toDisplay(message: ChatMessage): DisplayMessage {
  return {
    key: `m${message.id}`,
    role: message.role,
    content: message.content,
    persisted: true,
    modelTag: message.model_tag,
  };
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { isIncognito, selectedModel } = useSettings();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // A session's ephemerality is fixed when it is created, so the mode it was
  // opened under is what the current mode has to be compared against.
  // `null` means an unsaved draft, which belongs to whichever mode is on now.
  const [activeEphemeral, setActiveEphemeral] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState<SessionsStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [modelNotice, setModelNotice] = useState<string | null>(null);

  // Guards against a slow transcript fetch landing after the user has already
  // clicked a different chat, which would show the wrong conversation.
  const loadToken = useRef(0);

  // The reconnect poll below. Held in a ref so switching chats or unmounting
  // can stop it — an interval left running holds the composer disabled and
  // keeps hitting the API for a session nobody is looking at any more.
  const pollTimer = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setStatus('ready');
      setError(null);
    } catch (err) {
      setStatus('offline');
      setError(err instanceof Error ? err.message : 'could not load chats');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const newChat = useCallback(() => {
    loadToken.current += 1;
    stopPolling();
    setSending(false);
    setActiveSessionId(null);
    setActiveEphemeral(null);
    setMessages([]);
    setError(null);
  }, [stopPolling]);

  // Toggling incognito hides the open chat rather than resetting state in an
  // effect: continuing to append to a persisted session while the UI says
  // "off the record" would be a lie, but the conversation is not destroyed —
  // toggling back brings it into view again. Derived during render, so there
  // is no cascading re-render and no ordering to get wrong.
  const modeMismatch = activeEphemeral !== null && activeEphemeral !== isIncognito;
  const visibleMessages = modeMismatch ? NO_MESSAGES : messages;

  const selectSession = useCallback((id: string) => {
    const token = ++loadToken.current;
    stopPolling();
    setSending(false);
    setActiveSessionId(id);
    // Only non-ephemeral sessions are listed, so anything clickable is one.
    setActiveEphemeral(false);
    setMessages([]);
    setError(null);

    void (async () => {
      try {
        const loaded = await getMessages(id);
        if (loadToken.current !== token) return; // superseded by a newer click
        setMessages(loaded.map(toDisplay));
        setStatus('ready');

        // The generation outlives the request that started it, so reopening a
        // chat mid-answer has to pick it back up rather than show a transcript
        // that stops short. A failed status check is not worth surfacing: the
        // transcript above is already correct, and the answer will appear on
        // the next load.
        let generating = false;
        try {
          generating = (await checkChatStatus(id)).generating;
        } catch {
          return;
        }
        if (!generating || loadToken.current !== token) return;

        setSending(true);
        setMessages((prev) => [
          ...prev,
          {
            key: `reconnect-${Date.now()}`,
            role: 'assistant',
            content: '',
            persisted: false,
          },
        ]);

        // Polling, not streaming: the tokens already produced went to the
        // response this client never received, so there is nothing to resume —
        // only a finished transcript to wait for.
        stopPolling();
        pollTimer.current = window.setInterval(() => {
          void (async () => {
            if (loadToken.current !== token) {
              stopPolling();
              return;
            }
            try {
              if ((await checkChatStatus(id)).generating) return;
              stopPolling();
              if (loadToken.current !== token) return;
              setMessages((await getMessages(id)).map(toDisplay));
              setSending(false);
            } catch {
              // A blip between polls is not the end of the generation. Keep
              // the timer running; the next tick tries again.
            }
          })();
        }, RECONNECT_POLL_MS);
      } catch (err) {
        if (loadToken.current !== token) return;
        if (err instanceof SessionApiError && err.isNotFound) {
          // Deleted elsewhere — drop it rather than leave a dead row.
          setSessions((prev) => prev.filter((s) => s.session_id !== id));
          setActiveSessionId(null);
          setActiveEphemeral(null);
          setError('that chat no longer exists');
          return;
        }
        setStatus('offline');
        setError(err instanceof Error ? err.message : 'could not open that chat');
      }
    })();
  }, [stopPolling]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || sending) return;

      setSending(true);
      setError(null);

      // A message sent after the mode was toggled starts a new session rather
      // than joining the hidden one.
      let sessionId = modeMismatch ? null : activeSessionId;
      const history = modeMismatch ? [] : messages;

      // Echo immediately; the composer should never feel like it stalled.
      const optimisticKey = `local-${Date.now()}`;
      const assistantKey = `local-ai-${Date.now()}`;
      setMessages([
        ...history,
        { key: optimisticKey, role: 'user', content: trimmed, persisted: false },
        { key: assistantKey, role: 'assistant', content: '', persisted: false },
      ]);

      try {
        if (!sessionId) {
          const created = await createSession({ ephemeral: isIncognito });
          sessionId = created.session_id;
          setActiveSessionId(sessionId);
          setActiveEphemeral(isIncognito);
        }

        // One call. /api/chat records both turns server-side, so posting the
        // user message separately would store it twice.
        const reply = await sendChat(sessionId, trimmed, selectedModel || null, (p) => {
          if (p.phase !== 'generating' || !p.piece) return;
          const piece = p.piece;
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey ? { ...m, content: m.content + piece } : m,
            ),
          );
        });

        // Both placeholders go and the stored turns replace them, so the keys
        // and timestamps are the server's rather than this client's guesses.
        setMessages((prev) => [
          ...prev.filter((m) => m.key !== optimisticKey && m.key !== assistantKey),
          toDisplay(reply.user_message),
          toDisplay(reply.message),
        ]);

        // An override the server declined still produced an answer, from a
        // different model than the picker shows. Saying so beats letting the
        // operator believe they were talking to something they were not.
        setModelNotice(
          reply.model_choice.source === 'config' && reply.model_choice.rejected
            ? reply.model_choice.reason
            : null,
        );

        // Incognito chats are never listed, so there is nothing to refresh.
        if (!isIncognito) void refresh();
      } catch (err) {
        // Keep the message on screen, marked as failed, rather than deleting
        // it. Discarding it threw away what the person typed *and* dropped the
        // transcript back to empty, which switched the view back to the
        // greeting — so a failed send looked like nothing had happened at all.
        setMessages((prev) =>
          prev
            // The half-streamed answer goes; it is not a turn that landed.
            .filter((m) => m.key !== assistantKey)
            .map((m) =>
              m.key === optimisticKey ? { ...m, failed: true, persisted: false } : m,
            ),
        );
        setError(err instanceof Error ? err.message : 'could not send that message');
        if (err instanceof SessionApiError && err.status === 0) setStatus('offline');
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, isIncognito, messages, modeMismatch, refresh, selectedModel, sending],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      // Optimistic: a rename that fails is corrected by the refresh below.
      setSessions((prev) =>
        prev.map((s) => (s.session_id === id ? { ...s, title: clean } : s)),
      );
      try {
        await apiRenameSession(id, clean);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not rename that chat');
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setSessions((prev) => prev.filter((s) => s.session_id !== id));
      if (id === activeSessionId) newChat();
      try {
        await apiDeleteSession(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not delete that chat');
      } finally {
        void refresh();
      }
    },
    [activeSessionId, newChat, refresh],
  );

  const value = useMemo(
    () => ({
      sessions,
      activeSessionId: modeMismatch ? null : activeSessionId,
      messages: visibleMessages,
      status,
      error,
      sending,
      newChat,
      selectSession,
      sendMessage,
      modelNotice,
      rename,
      remove,
      refresh,
    }),
    [
      sessions,
      activeSessionId,
      modeMismatch,
      visibleMessages,
      status,
      error,
      modelNotice,
      sending,
      newChat,
      selectSession,
      sendMessage,
      rename,
      remove,
      refresh,
    ],
  );

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error('useSessions must be used inside a SessionsProvider');
  return ctx;
}
