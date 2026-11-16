import { projectVisiblePosts } from "./post-access.ts";

export const POST_MEDIA_LEASE_SECONDS = 120;
export type MediaDeliveryConfig = { baseUrl: string; tokenKey: string };
export class MediaLeaseUnavailable extends Error {}
const unavailable = () => new MediaLeaseUnavailable("Media unavailable");

/** Only exact server-stored object paths. Never signs a URL supplied by a caller,
 * directory capabilities, transforms, redirects, alternate origins or aliases. */
export function canonicalDeliveryUrl(value: unknown, baseUrl: string): string {
  if (typeof value !== "string" || value.length > 2048) throw unavailable();
  const base = new URL(baseUrl), url = new URL(value);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password ||
      url.origin !== base.origin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^\/(post-image|post-video|posts)\/[A-Za-z0-9_./-]+$/.test(url.pathname) ||
      value !== url.href || url.pathname.split("/").some((segment) => segment === "." || segment === "..")) throw unavailable();
  return url.href;
}

/** Bunny's official HS256 format: HMAC(path + expires), base64url, HS256- prefix.
 * No token_path/directory scope or ignored parameters; each asset is independent.
 * https://github.com/BunnyWay/BunnyCDN.TokenAuthentication/blob/master/nodejs/token.js */
export async function signPostMediaUrl(value: string, config: MediaDeliveryConfig, expiresAt: number): Promise<string> {
  const url = new URL(canonicalDeliveryUrl(value, config.baseUrl));
  if (!config.tokenKey || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw unavailable();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.tokenKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(url.pathname + expiresAt)));
  const token = "HS256-" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  url.searchParams.set("token", token);
  url.searchParams.set("expires", String(expiresAt));
  return url.href;
}

const selection = "id, author_id, visibility, is_nsfw, media:posts_media(type, url, _order, mime_type, thumbnail, live_photo_video_url)";
async function readPost(db: any, postId: number) {
  const { data, error } = await db.from("posts").select(selection).eq("id", postId).maybeSingle();
  if (error || !data) throw unavailable();
  return data;
}
function sourceSnapshot(post: any, config: MediaDeliveryConfig) {
  if (!Array.isArray(post.media) || post.media.length === 0 || post.media.length > 20) throw unavailable();
  const orders = new Set<number>();
  return [...post.media].sort((a, b) => a._order - b._order).map((media) => {
    if (!Number.isSafeInteger(media._order) || media._order < 0 || orders.has(media._order) || typeof media.type !== "string") throw unavailable();
    orders.add(media._order);
    return {
      order: media._order, type: media.type,
      url: canonicalDeliveryUrl(media.url, config.baseUrl),
      ...(typeof media.mime_type === "string" ? { mimeType: media.mime_type } : {}),
      ...(media.thumbnail ? { thumbnail: canonicalDeliveryUrl(media.thumbnail, config.baseUrl) } : {}),
      ...(media.live_photo_video_url ? { livePhotoVideoUrl: canonicalDeliveryUrl(media.live_photo_video_url, config.baseUrl) } : {}),
    };
  });
}
async function assertVisible(db: any, posts: any[], viewer: { authId: string | null; userId: number | null }) {
  if (posts.length === 0 || posts.length > 256 || posts.some((p) => !Number.isSafeInteger(Number(p.id)) || p.author_id == null)) throw unavailable();
  const visible = await projectVisiblePosts(db, posts, viewer);
  if (visible.length !== posts.length || visible.some((p) => p.isSpicyLocked !== false)) throw unavailable();
}
async function assertAllReferencesVisible(db: any, urls: string[], viewer: { authId: string | null; userId: number | null }) {
  // The same object can be referenced by several posts. A public duplicate must
  // not mint a capability bypassing a private/blocked/age-gated reference.
  const { data, error } = await db.rpc("post_media_delivery_parents", { p_urls: urls });
  if (error || !Array.isArray(data)) throw unavailable();
  await assertVisible(db, data, viewer);
}
export async function issuePostMediaLease(db: any, viewer: { authId: string | null; userId: number | null }, postId: number, config: MediaDeliveryConfig, now = Date.now()) {
  if (!Number.isSafeInteger(postId) || postId <= 0 || !config.tokenKey) throw unavailable();
  const post = await readPost(db, postId);
  await assertVisible(db, [post], viewer);
  const media = sourceSnapshot(post, config);
  const urls = [...new Set(media.flatMap((m) => [m.url, m.thumbnail, m.livePhotoVideoUrl].filter((u): u is string => typeof u === "string")))];
  await assertAllReferencesVisible(db, urls, viewer);
  const expiresAt = Math.floor(now / 1000) + POST_MEDIA_LEASE_SECONDS;
  const signed = await Promise.all(media.map(async (m) => ({
    ...m, url: await signPostMediaUrl(m.url, config, expiresAt),
    ...(m.thumbnail ? { thumbnail: await signPostMediaUrl(m.thumbnail, config, expiresAt) } : {}),
    ...(m.livePhotoVideoUrl ? { livePhotoVideoUrl: await signPostMediaUrl(m.livePhotoVideoUrl, config, expiresAt) } : {}),
  })));
  // Check again after asynchronous signing. Never emit stale replacements or a
  // lease for a relationship revoked while processing. Issued capabilities still
  // have a bounded 120s bearer window; they are not instant-revocable DRM.
  const fresh = await readPost(db, postId);
  if (JSON.stringify(sourceSnapshot(fresh, config)) !== JSON.stringify(media)) throw unavailable();
  await assertVisible(db, [fresh], viewer);
  await assertAllReferencesVisible(db, urls, viewer);
  if (Math.floor(Date.now() / 1000) >= expiresAt) throw unavailable();
  return { postId, expiresAt, media: signed };
}

/** Pre-publish remote handoffs have no post ID. A service-written upload receipt
 * proves ownership; mutable public media rows alone never do. */
export async function issueUploadMediaLease(db: any, authId: string, mediaIds: number[], config: MediaDeliveryConfig, now = Date.now()) {
  if (!authId || !Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > 4 || new Set(mediaIds).size !== mediaIds.length || mediaIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw unavailable();
  async function snapshot() {
    const [receipts, media] = await Promise.all([
      db.from("live_photo_upload_receipts").select("media_id, owner_auth_id, object_key, url, mime_type").in("media_id", mediaIds).eq("owner_auth_id", authId),
      db.from("media").select("id, filename, url, mime_type").in("id", mediaIds),
    ]);
    if (receipts.error || media.error || !Array.isArray(receipts.data) || !Array.isArray(media.data) || receipts.data.length !== mediaIds.length || media.data.length !== mediaIds.length) throw unavailable();
    return mediaIds.map((id) => {
      const receipt = receipts.data.find((r: any) => Number(r.media_id) === id && r.owner_auth_id === authId);
      const row = media.data.find((m: any) => Number(m.id) === id);
      if (!receipt || !row || row.filename !== receipt.object_key || row.url !== receipt.url || row.mime_type !== receipt.mime_type || typeof receipt.mime_type !== "string") throw unavailable();
      return { mediaId: id, url: canonicalDeliveryUrl(receipt.url, config.baseUrl), mimeType: receipt.mime_type };
    });
  }
  const original = await snapshot();
  const expiresAt = Math.floor(now / 1000) + POST_MEDIA_LEASE_SECONDS;
  const uploads = await Promise.all(original.map(async (m) => ({ ...m, url: await signPostMediaUrl(m.url, config, expiresAt) })));
  if (JSON.stringify(await snapshot()) !== JSON.stringify(original) || Math.floor(Date.now() / 1000) >= expiresAt) throw unavailable();
  return { expiresAt, uploads };
}
