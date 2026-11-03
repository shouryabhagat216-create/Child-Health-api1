import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 5173, the origin the backend allows through CORS (CORS_ORIGIN).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
