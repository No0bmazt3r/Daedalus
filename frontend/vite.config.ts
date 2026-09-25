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
  build: {
    rolldownOptions: {
      output: {
        // The libraries the chat needs on first paint, each in a chunk of its
        // own. It does not make the first load smaller — every one of these is
        // needed to render — but they change far less often than the app, so
        // after an update the browser keeps them cached and fetches only the
        // app's own code. The floating windows are split separately, by
        // `React.lazy` (see `src/lib/windowLoaders.ts`).
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](\.pnpm[\\/])?(react|react-dom|scheduler)[@\\/]/, priority: 3 },
            { name: "tanstack", test: /node_modules[\\/](\.pnpm[\\/])?@tanstack[+\\/]/, priority: 2 },
            { name: "ui", test: /node_modules[\\/](\.pnpm[\\/])?@(base-ui|floating-ui)[+\\/]/, priority: 1 },
          ],
        },
      },
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
