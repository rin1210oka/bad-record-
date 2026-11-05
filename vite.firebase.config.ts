import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({
  root: resolve(process.cwd(),'firebase-web'),
  envDir: process.cwd(), publicDir: false,
  plugins: [react()],
  build: {outDir: resolve(process.cwd(),'dist-firebase'), emptyOutDir:true},
  server: {host:'127.0.0.1',port:5173},
});
