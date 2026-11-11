// Test-only identity boundary for production media/lightbox components.
// Keep revoke-post-overlays real: only the account provider is synthetic, so
// these isolated fixtures never import native auth/storage or connect online.
const path = require('node:path');
function postMediaAuthFixture(root) {
  return {
    name: 'post-media-fixture-identity',
    setup(build) {
      // Preserve the legacy playback fixtures; enabled capability behavior has
      // its own mounted production-hook suite.
      build.onResolve({ filter: /(?:use-post-media-lease|use-post-preview-lease)$/ }, () => ({ path: 'lease-disabled', namespace: 'post-media-lease-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'post-media-lease-fixture' }, () => ({ loader: 'js', contents: 'export const usePostMediaLease=(_id,media)=>media;export const useLeasedPost=post=>post;export const usePostPreviewLease=(_id,fallback)=>fallback;export const usePostGridLease=tile=>tile;' }));
      build.onResolve({ filter: /^@dvnt\/app\/lib\/stores\/auth-store$/ }, () => ({ path: 'identity', namespace: 'post-media-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'post-media-fixture' }, () => ({
        resolveDir: root || path.resolve(__dirname, '../..'), loader: 'js',
        contents: 'import {create} from "zustand"; export const useAuthStore=create(()=>({user:{id:"fixture-viewer",authId:"fixture-viewer"}}));',
      }));
    },
  };
}
module.exports = { postMediaAuthFixture };
