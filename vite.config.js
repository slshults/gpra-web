import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'app/static'),
  base: '/static/',
  build: {
    outDir: path.resolve(__dirname, 'app/static'),
    emptyOutDir: false,
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'app/static/js/main.jsx')
      },
      output: {
        format: 'es',
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.endsWith('.css')) {
            return 'css/[name][extname]';
          }
          return '[name][extname]';
        },
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'radix-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-tooltip'],
          'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities']
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'app/static/js'),
      '@components': path.resolve(__dirname, 'app/static/js/components'),
      '@ui': path.resolve(__dirname, 'app/static/js/components/ui'),
      '@lib': path.resolve(__dirname, 'app/static/js/lib'),
      '@hooks': path.resolve(__dirname, 'app/static/js/hooks'),
      '@contexts': path.resolve(__dirname, 'app/static/js/contexts')
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom']
  }
});