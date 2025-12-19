import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Conditionally import Replit plugins only if REPL_ID is set
// These plugins are optional and only work in Replit environment
async function getReplitPlugins() {
  const plugins: any[] = [];
  
  // Runtime error overlay - try to load, but don't fail if unavailable
  try {
    if (process.env.REPL_ID) {
      const runtimeErrorOverlay = await import("@replit/vite-plugin-runtime-error-modal");
      plugins.push(runtimeErrorOverlay.default());
    }
  } catch (e) {
    // Plugin not available outside Replit - that's okay
  }
  
  // Cartographer and dev banner - only in development with REPL_ID
  if (process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined) {
    try {
      const cartographer = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer.cartographer());
    } catch (e) {
      // Plugin not available - that's okay
    }
    
    try {
      const devBanner = await import("@replit/vite-plugin-dev-banner");
      plugins.push(devBanner.devBanner());
    } catch (e) {
      // Plugin not available - that's okay
    }
  }
  
  return plugins;
}

// Note: Vite config can't use top-level await in TypeScript check
// This will work at runtime but may show errors in type checking
const replitPluginsPromise = getReplitPlugins();

export default defineConfig(async () => {
  const replitPlugins = await replitPluginsPromise;
  
  return {
  plugins: [
    react(),
    ...replitPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  };
});
