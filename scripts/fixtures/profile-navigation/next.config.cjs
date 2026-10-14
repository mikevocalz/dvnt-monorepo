const path = require('node:path');
const root = process.env.DVNT_PROFILE_REPO;
const source = path.join(root, 'scripts/fixtures/profile-navigation');
module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ['solito', 'react-native-web'],
  webpack(config, { webpack }) {
    config.resolve.modules = [...(config.resolve.modules || []), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
    config.resolve.extensions = ['.web.ts', '.web.tsx', '.web.js', ...config.resolve.extensions];
    config.resolve.alias = {
      ...config.resolve.alias,
      'profile-production': path.join(root, 'apps/web/src/components'),
      '@/components': path.join(root, 'apps/web/src/components'),
      '@dvnt/app/lib/stores/auth-store$': path.join(source, 'auth.ts'),
      '@dvnt/app/lib/profile/new-member-progress$': path.join(source, 'progress.ts'),
      '@dvnt/app/lib/auth/verified-only-prompt$': path.join(source, 'ancillary.tsx'),
      '@dvnt/app/lib/auth/supabase-jwt$': path.join(source, 'ancillary.tsx'),
      '@dvnt/app/features/screens/landing/sections/GlassHeader$': path.join(source, 'ancillary.tsx'),
      '@dvnt/app/features/screens/landing/sections/Footer$': path.join(source, 'ancillary.tsx'),
      '@dvnt/app/components/ui/html$': path.join(source, 'html.tsx'),
      '@dvnt/app': path.join(root, 'packages/app'),
      '@dvnt/ui$': path.join(root, 'packages/ui/src/form/Dialog.web.tsx'),
      'react-native$': require.resolve('react-native-web'),
    };
    if (process.env.PROFILE_NAVIGATION_POPUP_PATH) {
      // Change only the production dynamic host's popup import. All shells,
      // Next/Solito navigation, fixtures and shared policies remain identical.
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /^\.\/profile-completion-popup$/,
        resource => {
          if (resource.context === path.join(root, 'apps/web/src/components')) {
            resource.request = path.resolve(process.env.PROFILE_NAVIGATION_POPUP_PATH);
          }
        },
      ));
    }
    return config;
  },
};
