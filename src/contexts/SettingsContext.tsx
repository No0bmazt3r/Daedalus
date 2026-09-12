import { createContext, useContext, useState, type ReactNode } from 'react';

interface SettingsContextType {
  isIncognito: boolean;
  setIsIncognito: (val: boolean) => void;
  selectedModel: string;
  setSelectedModel: (val: string) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isIncognito, setIsIncognito] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Daedalus 2.0');

  return (
    <SettingsContext.Provider value={{
      isIncognito,
      setIsIncognito,
      selectedModel,
      setSelectedModel
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
