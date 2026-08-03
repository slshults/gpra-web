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
  // Upload source maps to PostHog whenever the required credentials are
  // exported to the process. Gating on env-var presence alone (not also
  // `npm_lifecycle_event === 'build'`) means every build that *can* upload
  // *does* — `npm run watch`, CI, or a bare `vite build` all symbolicate,
  // so exceptions arrive readable instead of as minified frames like `zr`.
  // Reading from `process.env` (not loadEnv) keeps a stale `.env` from
  // triggering uploads: the credentials must be exported per invocation.
  const uploadSourcemaps = Boolean(
    process.env.POSTHOG_PERSONAL_API_KEY
    && process.env.POSTHOG_PROJECT_ID
  );

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
    // Only emit source maps when we're going to upload them; otherwise a
    // build ships hidden `.map` files that PostHog never receives and that
    // sit unused in `dist/`.
    sourcemap: uploadSourcemaps ? 'hidden' : false,
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
        // Split vendor code by matching `node_modules` paths rather than
        // hand-listing packages. The object-literal form let Rollup park
        // shared React modules (`scheduler`, `react/jsx-runtime`) that
        // weren't named wherever it liked — with three entry points it put
        // them in `radix-vendor`, creating a cycle between the two chunks
        // and a "Cannot access '...' before initialization" TDZ crash at
        // startup. Matching on paths keeps *all* of React's runtime in one
        // chunk and *everything* under `@radix-ui/*` in another, so a new
        // Radix (or React) dependency can never be silently left off a list.
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (id.includes('/node_modules/@radix-ui/')) return 'radix-vendor';
          if (id.includes('/node_modules/@dnd-kit/')) return 'dnd-vendor';
          if (id.includes('/node_modules/recharts/')) return 'recharts-vendor';
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