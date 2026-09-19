import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import path from "path"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // Keeps the UI same-origin with the FastAPI backend in development, so
    // preference reads/writes need no CORS handling.
    //
    // The target differs by where Vite is running. On the host the backend is on
    // localhost; in the dev container it is the compose service `daedalus`,
    // which is what DAEDALUS_API_URL carries. Defaulted rather than required, so
    // `pnpm dev` on its own still works.
    proxy: {
      "/api": {
        target: process.env.DAEDALUS_API_URL ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
})
