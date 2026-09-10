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
    id: 'dark',
    name: 'Dark Matter',
    colors: {
      bg: '#282c34',
      sidebar: '#111111',
      card: '#161616',
      border: '#355a66',
      primary: '#9cdef2',
      text: '#9cdef2',
      textMuted: '#669dae',
    }
  },
  {
    id: 'light',
    name: 'Daylight',
    colors: {
      bg: '#f0ebe3',
      sidebar: '#faf6f0',
      card: '#ffffff',
      border: '#d4cdc2',
      primary: '#c47d5a',
      text: '#5a5248',
      textMuted: '#8a8278',
    }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    colors: {
      bg: '#0d1117',
      sidebar: '#161b22',
      card: '#21262d',
      border: '#30363d',
      primary: '#f85149',
      text: '#c9d1d9',
      textMuted: '#8b949e',
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colors: {
      bg: '#0a0a0f',
      sidebar: '#12101a',
      card: '#181523',
      border: '#9b30ff',
      primary: '#0ff0fc',
      text: '#0ff0fc',
      textMuted: '#89b4b6',
    }
  },
  {
    id: 'retrowave',
    name: 'Retrowave',
    colors: {
      bg: '#1a1a2e',
      sidebar: '#16213e',
      card: '#1a274c',
      border: '#533483',
      primary: '#e94560',
      text: '#e94560',
      textMuted: '#a93345',
    }
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: {
      bg: '#1b2a1b',
      sidebar: '#142414',
      card: '#1c301c',
      border: '#3d6b3d',
      primary: '#7cb871',
      text: '#a8d5a2',
      textMuted: '#71946e',
    }
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    colors: {
      bg: '#0b1a2c',
      sidebar: '#091422',
      card: '#132742',
      border: '#1e5074',
      primary: '#4facfe',
      text: '#64d2ff',
      textMuted: '#4a9ac0',
    }
  },
  {
    id: 'ume',
    name: 'Ume',
    colors: {
      bg: '#2b1b2e',
      sidebar: '#1e1420',
      card: '#271a2a',
      border: '#6c4675',
      primary: '#f5a0c0',
      text: '#f5c2e7',
      textMuted: '#b68fac',
    }
  },
  {
    id: 'copper',
    name: 'Copper',
    colors: {
      bg: '#1c1410',
      sidebar: '#140f0a',
      card: '#1f1811',
      border: '#7a5533',
      primary: '#d4764e',
      text: '#e8c39e',
      textMuted: '#b09477',
    }
  },
  {
    id: 'terminal',
    name: 'Terminal',
    colors: {
      bg: '#000000',
      sidebar: '#0a0a0a',
      card: '#111111',
      border: '#003b00',
      primary: '#00ff41',
      text: '#00ff41',
      textMuted: '#00a32a',
    }
  },
  {
    id: 'gpt',
    name: 'Anthropic Clone',
    colors: {
      bg: '#212121',
      sidebar: '#171717',
      card: '#2f2f2f',
      border: '#424242',
      primary: '#ececec',
      text: '#ececec',
      textMuted: '#949494',
    }
  },
  {
    id: 'cute',
    name: 'Cute',
    colors: {
      bg: '#fff0f5',
      sidebar: '#fff8fa',
      card: '#ffffff',
      border: '#f0c0d0',
      primary: '#ff6b9d',
      text: '#d4608a',
      textMuted: '#a84c6e',
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
  
  updateFavicon(theme.colors.primary);
  
  localStorage.setItem('daedalus-theme', themeId);
  window.dispatchEvent(new Event('daedalus-theme-change'));
}

async function updateFavicon(color: string) {
  try {
    const response = await fetch('/labyrinth.svg');
    let svgText = await response.text();
    
    // Make the entire SVG single-color based on the theme
    svgText = svgText.replace(/fill="[^"]*"/g, `fill="${color}"`);
    
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
  } catch (e) {
    console.error("Failed to update favicon", e);
  }
}
