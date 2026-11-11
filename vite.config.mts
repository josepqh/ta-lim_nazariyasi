import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// `npm run dev` serves the app here and passes /api to the local API server (tests/dev-server.js).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/chart.js')) return 'charts';
          // Only needed when a certificate is downloaded, so it loads then.
          if (/node_modules\/(pdf-lib|@pdf-lib|pako|qrcode|dijkstrajs|tslib)\//.test(id)) return 'certificate';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' }
  }
});
