import fs from 'fs';
import path from 'path';
import type { NextConfig } from 'next';
import type { Compiler, Compilation } from 'webpack';
import { withPayload } from '@payloadcms/next/withPayload';
import { withSentryConfig } from '@sentry/nextjs';

class CopySkiaPlugin {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('CopySkiaPlugin', (compilation: Compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'copy-skia',
          // @ts-ignore
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        async () => {
          const { sources } = compiler.webpack;
          const src = require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm');
          if (!compilation.getAsset('canvaskit.wasm')) {
            compilation.emitAsset(
              'canvaskit.wasm',
              new sources.RawSource(await fs.promises.readFile(src)),
            );
          }
        },
      );
    });
  }
}

const nextConfig: NextConfig = {
  // Keep only the genuinely server-only AWS SDK external. Do NOT externalize
  // @payloadcms/storage-s3 / plugin-cloud-storage — they ship the admin's
  // client component (S3ClientUploadHandler, referenced from the import map),
  // and externalizing them breaks /admin's build-time page-data collection.
  serverExternalPackages: ['@aws-sdk/client-s3', '@smithy/node-http-handler'],
  transpilePackages: [
    'react-native',
    'react-native-web',
    'react-native-css-interop',
    'nativewind',
    'solito',
    'three',
    'gsap',
    'expo',
    'expo-modules-core',
    '@expo/ui',
    '@expo/html-elements',
    '@react-native-community/datetimepicker',
    '@react-native-community/slider',
    'expo-apple-authentication',
    'expo-asset',
    'expo-audio',
    'expo-battery',
    'expo-blur',
    'expo-calendar',
    'expo-camera',
    'expo-clipboard',
    'expo-constants',
    'expo-crypto',
    'expo-device',
    'expo-file-system',
    'expo-font',
    'expo-haptics',
    'expo-image',
    'expo-image-manipulator',
    'expo-image-picker',
    'expo-linear-gradient',
    'expo-linking',
    'expo-live-photo',
    'expo-local-authentication',
    'expo-localization',
    'expo-location',
    'expo-maps',
    'expo-media-library',
    'expo-network',
    'expo-notifications',
    'expo-paste-input',
    'expo-print',
    'expo-router',
    'expo-screen-capture',
    'expo-screen-orientation',
    'expo-secure-store',
    'expo-share-intent',
    'expo-sharing',
    'expo-splash-screen',
    'expo-status-bar',
    'expo-symbols',
    'expo-system-ui',
    'expo-updates',
    'expo-video',
    'expo-video-thumbnails',
    'expo-web-browser',
    '@legendapp/list',
    '@legendapp/motion',
    '@dvnt/ui',
    '@dvnt/app',
    '@dvnt/api',
    '@dvnt/cms',
    '@dvnt/core',
    '@dvnt/functions',
    '@dvnt/observability',
    '@dvnt/types',
    '@shopify/react-native-skia',
  ],
  // Solito Image → next/image. App media is served from Bunny CDN and
  // dvntapp.live; avatars/assets also come from Supabase storage.
  images: {
    // Next's image optimizer refuses upstream images that resolve to a private
    // IP (SSRF guard). In dev the Payload CMS is on localhost:5173 (→ 127.0.0.1),
    // so optimization is skipped locally; production media is served from the
    // public CDN/domains below and stays fully optimized.
    unoptimized: process.env.NODE_ENV !== 'production',
    remotePatterns: [
      { protocol: 'https', hostname: '**.b-cdn.net' },
      { protocol: 'https', hostname: 'dvntapp.live' },
      { protocol: 'https', hostname: '**.dvntapp.live' },
      { protocol: 'https', hostname: '**.supabase.co' },
      // Local Payload (web-vite) media in dev.
      { protocol: 'http', hostname: 'localhost', port: '5173' },
    ],
  },
  // Same-origin auth proxy. Better Auth sets its session cookie on the request
  // host; calling the Supabase edge function cross-origin from localhost makes
  // that cookie third-party (browsers drop it → login/likes/comments silently
  // fail to persist a session). Proxying /api/auth/* through Next makes the
  // cookie FIRST-party. Pairs with EXPO_PUBLIC_AUTH_SAME_ORIGIN + the web auth
  // client pointing its baseURL at window.location.origin + basePath /api/auth.
  async rewrites() {
    const authUrl =
      process.env.EXPO_PUBLIC_AUTH_URL ??
      'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth';
    return [
      { source: '/api/auth/:path*', destination: `${authUrl}/api/auth/:path*` },
      // Same-origin EDGE-FUNCTION proxy. Browser calls to
      // supabase.co/functions/v1 are a cross-origin fetch that privacy
      // extensions / flaky networks can kill outright ("Failed to send a
      // request to the Edge Function" — seen live on the onboarding save).
      // The web supabase client rewrites functions URLs to /api/fn/* (see
      // packages/supabase/src/client.web.ts), making every edge call
      // first-party — same rationale as the /api/auth proxy above and the
      // Sentry /monitoring tunnel.
      {
        source: '/api/fn/:path*',
        destination:
          'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/:path*',
      },
    ];
  },
  // The authenticated web app lives under /feed (the AppShell). Native routes
  // protected screens at bare paths (e.g. /(protected)/sneaky-lynk/room/[id]),
  // so bare /sneaky-lynk/* web links — shared URLs, deep links, older clients —
  // would 404. Redirect them to the canonical /feed/sneaky-lynk/* route.
  async redirects() {
    return [
      // Canonical host. Browsing/installing the PWA from the Vercel default
      // domain names the installed app "dvnt-blog" (Chrome falls back to the
      // hostname for app identity there). Force everyone onto dvntapp.live.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'dvnt-blog.vercel.app' }],
        destination: 'https://dvntapp.live/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'dvnt-blog-mikefacesnys-projects.vercel.app' }],
        destination: 'https://dvntapp.live/:path*',
        permanent: true,
      },
      {
        source: '/sneaky-lynk/:path*',
        destination: '/feed/sneaky-lynk/:path*',
        permanent: false,
      },
    ];
  },
  webpack: (config, { webpack }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'react-native$': path.resolve(__dirname, 'src/platform/react-native-web.ts'),
      // expo-router → next/navigation bridge (shared screens render on Next).
      'expo-router$': path.resolve(__dirname, 'src/platform/expo-router.web.tsx'),
      '@sentry/react-native$': path.resolve(
        __dirname,
        'src/platform/sentry-react-native.web.ts',
      ),
      'lucide-react-native$': path.resolve(
        __dirname,
        'src/platform/lucide-react-native.web.ts',
      ),
      '@react-native-community/datetimepicker$': path.resolve(
        __dirname,
        'src/platform/datetimepicker.web.tsx',
      ),
      'react-native-pager-view$': path.resolve(
        __dirname,
        'src/platform/pager-view.web.tsx',
      ),
      'react-native-vision-camera$': path.resolve(
        __dirname,
        'src/platform/vision-camera.web.tsx',
      ),
      'react-native-vision-camera-barcode-scanner$': path.resolve(
        __dirname,
        'src/platform/vision-camera-barcode-scanner.web.ts',
      ),
      'react-native-qrcode-svg$': path.resolve(
        __dirname,
        'src/platform/qrcode-svg.web.tsx',
      ),
      '@fishjam-cloud/react-native-client$': path.resolve(
        __dirname,
        'src/platform/fishjam-react-native-client.web.tsx',
      ),
      '@fishjam-cloud/react-native-webrtc$': path.resolve(
        __dirname,
        'src/platform/fishjam-react-native-webrtc.web.ts',
      ),
      '@stripe/stripe-react-native$': path.resolve(
        __dirname,
        'src/platform/stripe-react-native.web.tsx',
      ),
      'react-native-reanimated/scripts/validate-worklets-version': path.resolve(
        __dirname,
        'src/platform/validate-worklets-version.ts',
      ),
      // NativeWind v5 dropped jsx-runtime exports; @expo/ui community components
      // still reference them — redirect to React's own runtime. (We deliberately
      // do NOT route this through react-native-css-interop: on this Next build
      // Tailwind is compiled to plain global CSS by @tailwindcss/postcss, so
      // forwarding `className` onto RNW components only collides with RNW's own
      // atomic css-view-* classes. Shared .web screens use raw semantic HTML
      // tags + Tailwind className instead — those have no RNW class to fight.)
      'nativewind/jsx-runtime': 'react/jsx-runtime',
      'nativewind/jsx-dev-runtime': 'react/jsx-dev-runtime',
      // Required by Skia web — suppress reanimated bundle warnings
      'react-native-reanimated/package.json': require.resolve(
        'react-native-reanimated/package.json',
      ),
      'react-native-reanimated': require.resolve('react-native-reanimated'),
      // Skia doesn't need the RN asset registry on web
      'react-native/Libraries/Image/AssetRegistry': false,
    };
    config.resolve.extensions = [
      '.web.ts',
      '.web.tsx',
      '.web.js',
      ...config.resolve.extensions,
    ];
    // Skia uses fs/path at build time only — stub them in the browser bundle
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      path: false,
    };
    config.module.rules.push({
      test: /\.(mp4|mov|webm|ttf|otf)$/i,
      type: 'asset/resource',
    });
    config.plugins = [
      ...(config.plugins ?? []),
      new CopySkiaPlugin(),
      // expo-media-library works on web EXCEPT its newer `ExpoMediaLibraryNext`
      // native module (no web build, imported unconditionally → hard crash).
      // Swap just that module for a web stub so the package loads; real picking
      // uses the browser/expo-image-picker file input.
      new webpack.NormalModuleReplacementPlugin(
        /(^|[\\/])ExpoMediaLibraryNext$/,
        path.resolve(__dirname, 'src/platform/expo-media-library-next.web.ts'),
      ),
      // RN globals + EXPO_PUBLIC_* env the shared code expects (Metro/Vite define
      // these; webpack must too). Values come from apps/web/.env via process.env.
      new webpack.DefinePlugin({
        __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
        // webpack 5 dropped the automatic Node `global` shim. RN/worklets code
        // that references bare `global` otherwise throws "global is not defined"
        // and blanks the whole app. Map it to globalThis (Metro/Vite do this too).
        global: 'globalThis',
        'process.env.EXPO_OS': JSON.stringify('web'),
        'process.env.EXPO_PUBLIC_SUPABASE_URL': JSON.stringify(
          process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
        ),
        'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(
          process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        ),
        'process.env.EXPO_PUBLIC_AUTH_URL': JSON.stringify(
          process.env.EXPO_PUBLIC_AUTH_URL ?? '',
        ),
        // Web auth client routes through the same-origin /api/auth proxy above.
        'process.env.EXPO_PUBLIC_AUTH_SAME_ORIGIN': JSON.stringify(
          process.env.EXPO_PUBLIC_AUTH_SAME_ORIGIN ?? 'true',
        ),
      }),
    ];
    return config;
  },
};

// withPayload wraps the existing custom webpack config (RNW aliases, Skia,
// DefinePlugin) and adds Payload's serverExternalPackages + admin handling.
// devBundleServerPackages:false keeps Payload's server deps external in dev so
// the heavy RNW/Skia webpack pipeline doesn't try to bundle pg/sharp/payload.
// withSentryConfig wraps LAST so it sees the final config: /monitoring tunnel
// (ad blockers eat direct beacons → wrong Web Vitals), source-map upload when
// SENTRY_AUTH_TOKEN is present (silently skipped otherwise), release naming
// dvnt@<version>+<sha> shared with mobile/edge.
const gitSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
process.env.SENTRY_RELEASE = `dvnt@${process.env.npm_package_version || '0.1.0'}${gitSha ? `+${gitSha}` : ''}`;

export default withSentryConfig(
  withPayload(nextConfig, { devBundleServerPackages: false }),
  {
    org: '5th-galaxy-studios',
    project: 'dvnt-web',
    silent: !process.env.CI,
    tunnelRoute: '/monitoring',
    disableLogger: true,
    widenClientFileUpload: true,
    release: { name: process.env.SENTRY_RELEASE },
  },
);
