import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { listModels, type SystemModel } from '../lib/systemClient';
import { activeChatModel, type ActiveChatModel } from '../lib/chatClient';

/**
 * Per-session UI state, including which model the composer will use.
 *
 * ## Why the list is filtered
 *
 * `/api/system/models` returns local Ollama models *and* configured cloud
 * endpoints. Offering both here would let an operator pick a cloud model to
 * answer a live reactor question, which Rule 1 forbids outright — cloud
 * endpoints exist as offline evaluation baselines and are never deployed. The
 * backend rejects such an override anyway, but a picker that lists a choice it
 * cannot honour is a bad picker.
 *
 * ## Why the default comes from the server
 *
 * The committed choice lives in `config/model_config.json` and, in `auto` mode,
 * resolves against whatever machine this is and whatever is installed on it.
 * Defaulting to "the first model in the list" would silently disagree with the
 * Forge's Deployment tab, and the two would drift. So the default is asked for,
 * and `deployedModel` keeps the reasoning around so the UI can show it.
 */

interface SettingsContextType {
  isIncognito: boolean;
  setIsIncognito: (val: boolean) => void;
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  /** Local, installed models only. Cloud endpoints are excluded by design. */
  models: SystemModel[];
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
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [deployedModel, setDeployedModel] = useState<ActiveChatModel | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Both in flight together: the list and the default are independent, and
    // the picker should not wait on two serial round trips to become usable.
    void Promise.allSettled([listModels(), activeChatModel()]).then(
      ([listed, active]) => {
        if (cancelled) return;

        const deployed = active.status === 'fulfilled' ? active.value : null;
        setDeployedModel(deployed);

        if (listed.status === 'rejected') {
          setModelsError('Error loading models');
          setModelsLoading(false);
          return;
        }

        const local = listed.value.filter((m) => m.type === 'local');
        setModels(local);
        setModelsLoading(false);

        setSelectedModel((prev) => {
          if (prev && local.some((m) => m.name === prev)) return prev;
          // The committed model first, so the composer agrees with the Forge.
          if (deployed?.tag && local.some((m) => m.name === deployed.tag)) {
            return deployed.tag;
          }
          return local[0]?.name ?? '';
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsContext.Provider value={{
      isIncognito,
      setIsIncognito,
      selectedModel,
      setSelectedModel,
      models,
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
