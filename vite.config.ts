import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The browser can't call api.anthropic.com directly (CORS + the API key must
// stay out of client code), so the dev server proxies /api/anthropic/* and
// injects the credentials. Two options (see README "API access"):
//   1. ANTHROPIC_API_KEY in .env.local (static key)
//   2. ANTHROPIC_AUTH_TOKEN in the shell env (short-lived OAuth token from
//      `ant auth print-credentials --env`) — needs the oauth beta header
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
  if (env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = env.ANTHROPIC_API_KEY
  } else if (env.ANTHROPIC_AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`
    headers['anthropic-beta'] = 'oauth-2025-04-20'
  }
  return {
    plugins: [react()],
    // onnxruntime-web must NOT be esbuild-pre-bundled: the dep optimizer
    // mangles its closure-compiled WebGPU/JSEP glue ("X.$b is not a
    // function" at session creation in dev). Production builds are fine —
    // this only affects the dev server.
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    worker: { format: 'es' as const },
    server: {
      proxy: {
        '/api/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
          headers,
          configure: (proxy) => {
            // Strip browser-identifying headers: if Origin is forwarded, the
            // API treats it as a direct browser call and rejects it unless the
            // dangerous-direct-browser-access opt-in is set. This is a
            // server-mediated request, so present it as one.
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
            })
          },
        },
      },
    },
  }
})
