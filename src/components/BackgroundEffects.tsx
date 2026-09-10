import { useEffect, useState, useRef } from 'react';

export function BackgroundEffects() {
  const [effect, setEffect] = useState('none');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const checkTheme = () => {
      const themeId = localStorage.getItem('daedalus-theme') || 'oled';
      const patterns: Record<string, string> = {
        midnight: 'rain',
        cyberpunk: 'synapse',
        ocean: 'constellations',
        forest: 'dots',
        terminal: 'dots',
        organs: 'rain'
      };
      setEffect(patterns[themeId] || 'none');
    };
    
    checkTheme();
    window.addEventListener('daedalus-theme-change', checkTheme);
    return () => window.removeEventListener('daedalus-theme-change', checkTheme);
  }, []);

  // Canvas Rain Effect
  useEffect(() => {
    if (effect !== 'rain' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const handleResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    window.addEventListener('resize', handleResize);

    const drops: { x: number, y: number, length: number, speed: number, alpha: number }[] = [];
    const MAX_DROPS = 100;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      
      const rootStyles = getComputedStyle(document.documentElement);
      // Fallback to a default color if primary isn't set
      const themeColor = rootStyles.getPropertyValue('--primary').trim() || '#ffffff';

      if (drops.length < MAX_DROPS && Math.random() < 0.5) {
        const length = 20 + Math.random() * 40;
        const speed = 4 + Math.random() * 8;
        drops.push({ 
          x: Math.random() * W, 
          y: -length, 
          length: length, 
          speed: speed, 
          alpha: 0.2 + Math.random() * 0.5 
        });
      }

      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.y += d.speed;
        
        if (d.y > H + d.length) { 
          drops.splice(i, 1); 
          continue;
        }

        const grad = ctx.createLinearGradient(d.x, d.y - d.length, d.x, d.y);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, themeColor);
        
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = d.alpha;
        
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - d.length);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
    };

    draw();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [effect]);

  if (effect === 'none') return null;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none mix-blend-screen opacity-50">
      {effect === 'rain' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
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
