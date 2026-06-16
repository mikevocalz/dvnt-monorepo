import { payloadPlugin } from '@payloadcms/tanstack-start/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createLogger, defineConfig, mergeConfig } from 'vite'

const require = createRequire(import.meta.url)
// Resolve the installed @payloadcms/ui package dir via node resolution so SCSS
// `~@payloadcms/ui/...` imports work whether the dep is hoisted to the workspace
// root (pnpm monorepo) or in the app's own node_modules (standalone). The
// package's `exports` map hides `./package.json`, so derive the root from its
// main entry by trimming at `/dist/`.
const payloadUiMain = require.resolve('@payloadcms/ui')
const payloadUiDir = payloadUiMain.slice(0, payloadUiMain.indexOf('/dist/'))

const logger = createLogger()
const shouldSuppress = (msg: string) =>
  msg.includes('points to missing source files') ||
  msg.includes('Sourcemap for') // covers any sourcemap-related warning variants

const originalWarn = logger.warn.bind(logger)
logger.warn = (msg, options) => {
  if (typeof msg === 'string' && shouldSuppress(msg)) return
  originalWarn(msg, options)
}
const originalWarnOnce = logger.warnOnce.bind(logger)
logger.warnOnce = (msg, options) => {
  if (typeof msg === 'string' && shouldSuppress(msg)) return
  originalWarnOnce(msg, options)
}

const originalConsoleInfo = console.info.bind(console)
console.info = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('was modified by another process')) return
  originalConsoleInfo(...args)
}
const originalConsoleLog = console.log.bind(console)
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('was modified by another process')) return
  originalConsoleLog(...args)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig((env) =>
  mergeConfig(
    payloadPlugin({
      additionalAliases: [
        {
          find: /^@\//,
          replacement: path.resolve(__dirname, 'src') + '/',
        },
      ],
      additionalOptimizeDepsInclude: ['react/compiler-runtime'],
      payloadConfigPath: path.resolve(__dirname, 'src', 'payload.config.ts'),
      reactPlugin: viteReact({
        exclude: [/node_modules\/@payloadcms\/ui\/dist/],
        include: /\.[jt]sx?$/,
      }),
      rscPlugin: rsc({ serverHandler: false }),
      tanstackStart,
    })(env),
    {
      customLogger: logger,
      // `pg` (and its CJS deps) must be loaded natively by Node, not transformed
      // by Vite's SSR runner — otherwise its internal default-imports break
      // (the read-only app-data endpoints use it). Keep it external.
      ssr: {
        external: [
          'pg',
          'pg-pool',
          'pg-connection-string',
          'pgpass',
          'pg-types',
          // react-native-web (+ its CJS dep inline-style-prefixer) must load
          // natively in SSR — Vite's SSR runner mangles RN-web's internal CJS
          // default-imports, which crashed the WHOLE server module graph (every
          // /api/* 500'd). External for SSR only; the client still bundles it.
          'inline-style-prefixer',
          'react-native-web',
        ],
      },
      // react-native-web for the custom moderation dashboard route. Payload's
      // admin bundle never imports `react-native`, so aliasing it globally only
      // affects the dashboard. RN-web + @expo/html-elements ship compiled JS.
      define: { __DEV__: 'false' },
      resolve: {
        alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
      },
      optimizeDeps: {
        // @expo/html-elements ships .tsx source and can't be prebundled; let it
        // be transformed on the fly. The dashboard route is client-only so these
        // never enter the SSR graph.
        include: [
          'react-native-web',
          '@tanstack/react-query',
          '@tanstack/react-table',
          '@tanstack/react-virtual',
          '@tanstack/react-pacer',
        ],
      },
      build: {
        rollupOptions: {
          output: {
            // Function form: the installed Vite 8 uses rolldown, which doesn't
            // accept the object form of manualChunks. Split the heavy Payload
            // admin bundle out for better caching.
            manualChunks(id: string) {
              if (
                id.includes('@payloadcms/ui') ||
                id.includes('@payloadcms/tanstack-start') ||
                id.includes('@payloadcms/richtext-lexical')
              ) {
                return 'payload-admin'
              }
            },
          },
        },
      },
      css: {
        preprocessorOptions: {
          scss: {
            importers: [
              {
                findFileUrl(url: string) {
                  // Map any `~@payloadcms/ui/<rest>` to the resolved package dir.
                  if (url.startsWith('~@payloadcms/ui/')) {
                    const rest = url.slice('~@payloadcms/ui/'.length)
                    const target = rest === 'scss' ? 'dist/scss/styles.scss' : rest
                    return new URL('file://' + path.join(payloadUiDir, target))
                  }
                  return null
                },
              },
            ],
          },
        },
      },
      server: {
        warmup: {
          clientFiles: [
            './src/app/__root.tsx',
            './src/app/_payload.tsx',
            './src/app/_payload/admin.index.tsx',
            './src/app/_payload/admin.$.tsx',
          ],
        },
      },
    },
  ),
)
