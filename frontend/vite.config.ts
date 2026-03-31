import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
const backendTarget = "http://127.0.0.1:8000";

export default defineConfig({
  // Lit .env à la racine du dépôt (VITE_*) — même fichier que le backend charge via ../.env
  envDir: path.resolve(__dirname, ".."),
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/chat": { target: backendTarget, changeOrigin: true },
      "/embed-document": { target: backendTarget, changeOrigin: true },
      "/create-admin-user": { target: backendTarget, changeOrigin: true },
      "/health": { target: backendTarget, changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});