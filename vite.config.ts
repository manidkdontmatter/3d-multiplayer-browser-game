/**
 * Purpose: This file configures the Vite dev/build pipeline used to run and bundle the project.
 * Scope: It belongs to the tooling/build configuration layer.
 * Human Summary: Keeps one clear responsibility so this codebase stays easier to navigate and maintain.
 */
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
});
