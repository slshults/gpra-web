import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import posthog from '@posthog/rollup-plugin';
import path from 'path';
import { execFileSync } from 'child_process';

const getGitHash = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname }).toString().trim();
  } catch {
    return 'dev';
  }
};

export default defineConfig(({ mode }) => {
  // Only upload source maps to PostHog when the build is invoked as a
  // production build (`npm run build`, not `npm run watch` which proxies
  // through nodemon) AND the required env vars are exported to the
  // process. Reading from `process.env` (not loadEnv) means a stale
  // `.env` won't trigger uploads — uploads are opt-in per invocation.
  const uploadSourcemaps =
    process.env.npm_lifecycle_event === 'build'
    && process.env.POSTHOG_PERSONAL_API_KEY
    && process.env.POSTHOG_PROJECT_ID;

  return {
  plugins: [
    react(),
    uploadSourcemaps && posthog({
      personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
      projectId: process.env.POSTHOG_PROJECT_ID,
      sourcemaps: {
        enabled: true,
        releaseName: 'gpra-web',
        releaseVersion: getGitHash(),
      },
    }),
  ].filter(Boolean),
  base: '/static/dist/',
  build: {
    outDir: path.resolve(__dirname, 'app/static/dist'),
    emptyOutDir: true,
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 600,
    cssCodeSplit: false,  // Prevent duplicate Tailwind CSS in per-chunk files
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'app/static/js/main.jsx'),
        auth: path.resolve(__dirname, 'app/static/js/auth.jsx'),
        'chord-editor': path.resolve(__dirname, 'app/static/js/chord-editor.jsx'),
      },
      output: {
        format: 'es',
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.endsWith('.css')) {
            return 'css/main.css';  // All CSS consolidated to main.css
          }
          return '[name][extname]';
        },
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'radix-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-tooltip'],
          'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'recharts-vendor': ['recharts']
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
      '@contexts': path.resolve(__dirname, 'app/static/js/contexts'),
      '@utils': path.resolve(__dirname, 'app/static/js/utils')
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom']
  }
  };
});