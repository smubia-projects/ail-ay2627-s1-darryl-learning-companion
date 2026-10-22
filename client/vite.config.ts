import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const envDir = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const apiPort = process.env.PORT?.trim() || env.PORT?.trim() || '8080';
  return {
    plugins: [react(), tailwindcss()], envDir,
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } },
  };
});
