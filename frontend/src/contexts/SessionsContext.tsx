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
import { sendChat } from '../lib/chatClient';

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
  /** False for an optimistic echo, and for mock replies the backend never saw. */
  persisted: boolean;
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

function toDisplay(message: ChatMessage): DisplayMessage {
  return {
    key: `m${message.id}`,
    role: message.role,
    content: message.content,
    persisted: true,
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
    setActiveSessionId(null);
    setActiveEphemeral(null);
    setMessages([]);
    setError(null);
  }, []);

  // Toggling incognito hides the open chat rather than resetting state in an
  // effect: continuing to append to a persisted session while the UI says
  // "off the record" would be a lie, but the conversation is not destroyed —
  // toggling back brings it into view again. Derived during render, so there
  // is no cascading re-render and no ordering to get wrong.
  const modeMismatch = activeEphemeral !== null && activeEphemeral !== isIncognito;
  const visibleMessages = modeMismatch ? NO_MESSAGES : messages;

  const selectSession = useCallback((id: string) => {
    const token = ++loadToken.current;
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
  }, []);

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
      setMessages([
        ...history,
        { key: optimisticKey, role: 'user', content: trimmed, persisted: false },
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
        const reply = await sendChat(sessionId, trimmed, selectedModel || null);

        setMessages((prev) => [
          ...prev.map((m) => (m.key === optimisticKey ? toDisplay(reply.user_message) : m)),
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
        setMessages((prev) => prev.filter((m) => m.key !== optimisticKey));
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
