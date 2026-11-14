import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser only talks to this server (/api/...), and Vite forwards the calls to the
// chosen API. Same origin for the browser, so no CORS changes are needed in any API.
// Pick the implementation with API_TARGET, e.g. API_TARGET=http://127.0.0.1:3000 npm run dev
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8000";

const proxy = {
  "/api": {
    target: apiTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  define: {
    __API_TARGET__: JSON.stringify(apiTarget), // shown in the footer
  },
  server: { proxy },
  preview: { proxy },
});
