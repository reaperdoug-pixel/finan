import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const portaWeb = Number(process.env.WEB_PORT ?? 5173);
const apiProxy = process.env.API_PROXY ?? "http://127.0.0.1:3000";
const hostWeb = process.env.WEB_HOST;

export default defineConfig({
  plugins: [react()],
  server: {
    port: portaWeb,
    host: hostWeb || undefined,
    strictPort: true,
    // Em dev, /api vai para a API local. Em produção, o Caddy faz o mesmo.
    // WEB_PORT e API_PROXY deixam o e2e subir numa porta própria, sem misturar com o finan_dev.
    proxy: { "/api": { target: apiProxy, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
