import { createContext, useCallback, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { listModels, type SystemModel } from '../lib/systemClient';
import { activeChatModel, type ActiveChatModel } from '../lib/chatClient';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

/**
 * Per-session UI state, including which model the composer will use.
 *
 * ## Why the list is split rather than filtered (but both halves are usable)
 *
 * `/api/system/models` returns local Ollama models *and* cloud ones — both
 * Ollama's own `*-cloud` tags and the configured benchmark endpoints. Only the
 * local half is selectable: letting an operator pick a cloud model to answer a
 * live reactor question is what Rule 1 forbids outright, and `choose_model`
 * rejects such an override anyway.
 *
 * They are handed over as `referenceModels` and are selectable, under their own
 * heading and their own warning. Rule 1 is narrowed from *prevented* to
 * *recorded*: `choose_model` honours the override, the turn is logged
 * `source='chat_cloud'` rather than `'chat'`, and the transcript marks which
 * answers came from off the machine. Every Objective 3 query filters
 * `source = 'chat'` and keeps describing the local production path unchanged.
 *
 * The split stays because the two are not interchangeable and the picker must
 * not imply they are — one is what ships, the other is what it is measured
 * against.
 *
 * ## Why the default comes from the server
 *
 * The committed choice lives in `config/model_config.json` and, in `auto` mode,
 * resolves against whatever machine this is and whatever is installed on it.
 * Defaulting to "the first model in the list" would silently disagree with the
 * Forge's Deployment tab, and the two would drift. So the default is asked for,
 * and `deployedModel` keeps the reasoning around so the UI can show it.
 *
 * ## Why the list follows the machine, not the page load
 *
 * It is re-fetched whenever the backend reports a model change (`models`, or a
 * cloud `endpoints` edit) — a pull or delete in the Forge, or `ollama rm` in a
 * terminal. It used to be fetched once, so a deleted model stayed in the picker
 * until a reload and a send to it failed. If the selected model is the one that
 * went, the selection falls back the same way the first load chooses: the
 * committed model, else the first local one.
 */

interface SettingsContextType {
  isIncognito: boolean;
  setIsIncognito: (val: boolean) => void;
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  /** Local, installed models. The production path. */
  models: SystemModel[];
  /** Cloud models. Selectable, but an evaluation override — see each `note`. */
  referenceModels: SystemModel[];
  modelsLoading: boolean;
  modelsError: string | null;
  /** What the Forge committed, and why. Null until resolved. */
  deployedModel: ActiveChatModel | null;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isIncognito, setIsIncognito] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<SystemModel[]>([]);
  const [referenceModels, setReferenceModels] = useState<SystemModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [deployedModel, setDeployedModel] = useState<ActiveChatModel | null>(null);

  // Only the newest response is applied. Two changes in quick succession start
  // two fetches, and the older one must not land last and win.
  const latest = useRef(0);

  const refreshModels = useCallback(() => {
    const ticket = ++latest.current;

    // Both in flight together: the list and the default are independent, and
    // the picker should not wait on two serial round trips to become usable.
    void Promise.allSettled([listModels(), activeChatModel()]).then(
      ([listed, active]) => {
        if (ticket !== latest.current) return;

        const deployed = active.status === 'fulfilled' ? active.value : null;
        setDeployedModel(deployed);

        if (listed.status === 'rejected') {
          setModelsError('Error loading models');
          setModelsLoading(false);
          return;
        }

        const local = listed.value.filter((m) => m.type === 'local');
        setModels(local);
        setReferenceModels(listed.value.filter((m) => m.type === 'cloud'));
        setModelsError(null);
        setModelsLoading(false);

        setSelectedModel((prev) => {
          // A cloud pick is honoured on reselect, but never becomes the
          // default: the default has to be the thing that ships.
          if (prev && listed.value.some((m) => m.name === prev)) return prev;
          // The committed model first, so the composer agrees with the Forge.
          if (deployed?.tag && local.some((m) => m.name === deployed.tag)) {
            return deployed.tag;
          }
          return local[0]?.name ?? '';
        });
      },
    );
  }, []);

  useEffect(() => {
    refreshModels();
    // Invalidate any response still in flight when the provider unmounts.
    const counter = latest;
    return () => { counter.current++; };
  }, [refreshModels]);

  useLiveRefresh(['models', 'endpoints'], refreshModels);

  return (
    <SettingsContext.Provider value={{
      isIncognito,
      setIsIncognito,
      selectedModel,
      setSelectedModel,
      models,
      referenceModels,
      modelsLoading,
      modelsError,
      deployedModel,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
