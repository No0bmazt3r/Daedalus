import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { listModels, type SystemModel } from '../lib/systemClient';

interface SettingsContextType {
  isIncognito: boolean;
  setIsIncognito: (val: boolean) => void;
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  models: SystemModel[];
  modelsLoading: boolean;
  modelsError: string | null;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isIncognito, setIsIncognito] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<SystemModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    listModels()
      .then((fetchedModels) => {
        setModels(fetchedModels);
        setModelsLoading(false);
        if (fetchedModels.length > 0) {
          // If no model is selected or the selected model is not in the list, default to the first one
          setSelectedModel((prev) => 
            prev && fetchedModels.some(m => m.name === prev) ? prev : fetchedModels[0].name
          );
        }
      })
      .catch((err) => {
        console.error("Failed to fetch models", err);
        setModelsError("Error loading models");
        setModelsLoading(false);
      });
  }, []);

  return (
    <SettingsContext.Provider value={{
      isIncognito,
      setIsIncognito,
      selectedModel,
      setSelectedModel,
      models,
      modelsLoading,
      modelsError
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
