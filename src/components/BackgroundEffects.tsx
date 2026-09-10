import { useEffect, useState } from 'react';

export function BackgroundEffects() {
  const [effect, setEffect] = useState('none');

  useEffect(() => {
    const checkTheme = () => {
      const themeId = localStorage.getItem('daedalus-theme') || 'oled';
      const patterns: Record<string, string> = {
        midnight: 'rain',
        cyberpunk: 'synapse',
        ocean: 'constellations',
        forest: 'dots',
        terminal: 'dots'
      };
      setEffect(patterns[themeId] || 'none');
    };
    
    checkTheme();
    window.addEventListener('daedalus-theme-change', checkTheme);
    return () => window.removeEventListener('daedalus-theme-change', checkTheme);
  }, []);

  if (effect === 'none') return null;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-20 transition-opacity duration-1000 mix-blend-screen">
      {effect === 'rain' && (
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQwIj48cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPg==')] opacity-40" 
             style={{ animation: 'rain-fall 2s linear infinite', backgroundSize: '20px 80px' }} />
      )}
      {effect === 'dots' && (
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxjaXJjbGUgY3g9IjEiIGN5PSIxIiByPSIxIiBmaWxsPSIjZmZmZmZmIi8+PC9zdmc+')] opacity-30" 
             style={{ backgroundSize: '16px 16px' }} />
      )}
      {effect === 'constellations' && (
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent" 
             style={{ animation: 'pulse-slow 4s ease-in-out infinite' }} />
      )}
      {effect === 'synapse' && (
        <div className="absolute inset-0 opacity-20 bg-[linear-gradient(45deg,_transparent_25%,_rgba(255,255,255,0.2)_50%,_transparent_75%)]" 
             style={{ backgroundSize: '20px 20px', animation: 'synapse-flow 3s linear infinite' }} />
      )}
    </div>
  );
}
