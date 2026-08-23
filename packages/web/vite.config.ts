import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  // Sale al public/ de la raíz del monorepo, no a packages/web/dist.
  // Passenger deduce la raíz de la aplicación como el DIRECTORIO PADRE del document
  // root, así que el docroot tiene que ser <raíz>/public para que el archivo de
  // arranque `packages/api/dist/server.js` se resuelva bien. Ver docs/DEPLOY-PLESK.md.
  build: { outDir: '../../public', emptyOutDir: true, sourcemap: false },
});
