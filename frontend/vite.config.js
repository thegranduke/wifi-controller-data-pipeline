import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In Docker: VITE_PROXY_TARGET=http://backend:8000
// Locally: defaults to http://localhost:8000
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
