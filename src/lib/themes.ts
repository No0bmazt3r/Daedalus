export interface Theme {
  id: string;
  name: string;
  colors: {
    bg: string;
    sidebar: string;
    card: string;
    border: string;
    primary: string;
    text: string;
    textMuted: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: 'oled',
    name: 'OLED Black (Default)',
    colors: {
      bg: '#000000',
      sidebar: '#09090b', // zinc-950
      card: '#18181b', // zinc-900
      border: '#27272a', // zinc-800
      primary: '#34d399', // emerald-400
      text: '#f4f4f5', // zinc-100
      textMuted: '#a1a1aa', // zinc-400
    }
  },
  {
    id: 'anthropic',
    name: 'Classic Gray',
    colors: {
      bg: '#212121',
      sidebar: '#18181a',
      card: '#2f2f2f',
      border: '#3f3f46',
      primary: '#d4d4d8', 
      text: '#e4e4e7',
      textMuted: '#a1a1aa',
    }
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    colors: {
      bg: '#0b1a2c',
      sidebar: '#060d16',
      card: '#132742',
      border: '#1e5074',
      primary: '#4facfe',
      text: '#e0f2fe',
      textMuted: '#7dd3fc',
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colors: {
      bg: '#120414',
      sidebar: '#0a020b',
      card: '#200b24',
      border: '#ff00ff',
      primary: '#00ffff',
      text: '#ffffff',
      textMuted: '#f0abfc',
    }
  }
];

export function applyTheme(themeId: string) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  
  const root = document.documentElement;
  root.style.setProperty('--bg', theme.colors.bg);
  root.style.setProperty('--sidebar', theme.colors.sidebar);
  root.style.setProperty('--card', theme.colors.card);
  root.style.setProperty('--border', theme.colors.border);
  root.style.setProperty('--primary', theme.colors.primary);
  root.style.setProperty('--text-main', theme.colors.text);
  root.style.setProperty('--text-muted', theme.colors.textMuted);
  
  localStorage.setItem('daedalus-theme', themeId);
}
