#!/usr/bin/env npx ts-node
/**
 * Backend Migration Script: Backfill Video Thumbnails
 *
 * This script finds all video posts without thumbnails in the database,
 * generates thumbnails from the video files, uploads them to Bunny CDN,
 * and updates the post records.
 *
 * Prerequisites:
 * - ffmpeg installed on the system (brew install ffmpeg)
 * - Node.js environment with access to the Supabase API
 * - Bunny CDN credentials configured
 *
 * Usage:
 *   npx ts-node scripts/backfill-video-thumbnails.ts
 *   # Or with dry run:
 *   DRY_RUN=true npx ts-node scripts/backfill-video-thumbnails.ts
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";

// Load environment variables
require("dotenv").config();

// Configuration
const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://npfjanxturvmjyevoyfo.supabase.co";
const BUNNY_STORAGE_ZONE = process.env.EXPO_PUBLIC_BUNNY_STORAGE_ZONE || "dvnt";
const BUNNY_STORAGE_API_KEY =
  process.env.EXPO_PUBLIC_BUNNY_STORAGE_API_KEY || "";
const BUNNY_STORAGE_REGION =
  process.env.EXPO_PUBLIC_BUNNY_STORAGE_REGION || "de";
const BUNNY_CDN_URL =
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL || "https://dvnt.b-cdn.net";
const DRY_RUN = process.env.DRY_RUN === "true";

console.log("=".repeat(60));
console.log("Video Thumbnail Backfill Script");
console.log("=".repeat(60));
console.log(`API URL: ${API_URL}`);
console.log(`Bunny CDN: ${BUNNY_CDN_URL}`);
console.log(`Dry Run: ${DRY_RUN}`);
console.log("=".repeat(60));

interface MediaItem {
  type: "image" | "video";
  url: string;
  thumbnail?: string;
}

interface Post {
  id: string;
  media: MediaItem[];
  createdAt: string;
}

/**
 * Fetch all posts from the API
 */
async function fetchAllPosts(): Promise<Post[]> {
  const allPosts: Post[] = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;

  console.log("\nFetching posts from API...");

  while (hasMore) {
    const url = `${API_URL}/api/posts?limit=${limit}&page=${page}&depth=0`;
    console.log(`  Fetching page ${page}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch posts: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    const posts = data.docs || [];
    allPosts.push(...posts);

    hasMore = data.hasNextPage;
    page++;
  }

  console.log(`  Total posts fetched: ${allPosts.length}`);
  return allPosts;
}

/**
 * Find video posts that need thumbnails
 */
function findVideosNeedingThumbnails(posts: Post[]): Post[] {
  return posts.filter((post) => {
    if (!post.media || !Array.isArray(post.media)) return false;

    // Check if first media is a video without thumbnail
    const firstMedia = post.media[0];
    if (!firstMedia) return false;

    const isVideo = firstMedia.type === "video";
    const hasNoThumbnail = !firstMedia.thumbnail;
    const hasValidUrl =
      firstMedia.url &&
      (firstMedia.url.startsWith("http://") ||
        firstMedia.url.startsWith("https://"));

    return isVideo && hasNoThumbnail && hasValidUrl;
  });
}

/**
 * Download a video file to temp directory
 */
async function downloadVideo(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
    const file = fs.createWriteStream(tempPath);

    const protocol = videoUrl.startsWith("https") ? https : http;
    protocol
      .get(videoUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(tempPath);
            downloadVideo(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download video: ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(tempPath);
        });
      })
      .on("error", (err) => {
        fs.unlink(tempPath, () => {}); // Delete temp file on error
        reject(err);
      });
  });
}

/**
 * Generate thumbnail from video using FFmpeg
 */
async function generateThumbnail(videoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const thumbnailPath = videoPath.replace(".mp4", "_thumb.jpg");

    // FFmpeg command to extract frame at 0.5 seconds
    const args = [
      "-i",
      videoPath,
      "-ss",
      "0.5",
      "-vframes",
      "1",
      "-vf",
      "scale=720:-2",
      "-q:v",
      "2",
      "-y",
      thumbnailPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(thumbnailPath)) {
        resolve(thumbnailPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Upload thumbnail to Bunny CDN
 */
async function uploadToBunny(
  filePath: string,
  remotePath: string,
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const storageHost =
    BUNNY_STORAGE_REGION === "de"
      ? "storage.bunnycdn.com"
      : `${BUNNY_STORAGE_REGION}.storage.bunnycdn.com`;

  const uploadUrl = `https://${storageHost}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      AccessKey: BUNNY_STORAGE_API_KEY,
      "Content-Type": "image/jpeg",
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bunny upload failed: ${response.status} - ${body}`);
  }

  return `${BUNNY_CDN_URL}/${remotePath}`;
}

/**
 * Update post with thumbnail
 */
async function updatePost(postId: string, media: MediaItem[]): Promise<void> {
  const url = `${API_URL}/api/posts/${postId}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ media }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update post: ${response.status} - ${body}`);
  }
}

/**
 * Cleanup temporary files
 */
function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Process a single post
 */
async function processPost(post: Post): Promise<boolean> {
  const videoUrl = post.media[0].url;
  console.log(`\n  Post ${post.id}:`);
  console.log(`    Video URL: ${videoUrl.substring(0, 60)}...`);

  if (DRY_RUN) {
    console.log(`    [DRY RUN] Would generate and upload thumbnail`);
    return true;
  }

  let videoPath = "";
  let thumbPath = "";

  try {
    // Download video
    console.log(`    Downloading video...`);
    videoPath = await downloadVideo(videoUrl);
    console.log(`    Downloaded to: ${videoPath}`);

    // Generate thumbnail
    console.log(`    Generating thumbnail...`);
    thumbPath = await generateThumbnail(videoPath);
    console.log(`    Generated: ${thumbPath}`);

    // Upload to Bunny CDN
    const remotePath = `posts/thumbnails/${post.id}_thumb.jpg`;
    console.log(`    Uploading to Bunny CDN...`);
    const thumbnailUrl = await uploadToBunny(thumbPath, remotePath);
    console.log(`    Uploaded: ${thumbnailUrl}`);

    // Update post with thumbnail
    console.log(`    Updating post record...`);
    const updatedMedia = post.media.map((m, i) => {
      if (i === 0) {
        return { ...m, thumbnail: thumbnailUrl };
      }
      return m;
    });
    await updatePost(post.id, updatedMedia);
    console.log(`    ✓ Post updated successfully`);

    return true;
  } catch (error) {
    console.error(`    ✗ Failed:`, error);
    return false;
  } finally {
    cleanup(videoPath, thumbPath);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    // Check ffmpeg is installed
    try {
      const { execSync } = require("child_process");
      execSync("ffmpeg -version", { stdio: "ignore" });
    } catch {
      console.error("ERROR: ffmpeg is not installed. Run: brew install ffmpeg");
      process.exit(1);
    }

    // Check Bunny API key
    if (!BUNNY_STORAGE_API_KEY && !DRY_RUN) {
      console.error("ERROR: EXPO_PUBLIC_BUNNY_STORAGE_API_KEY is not set");
      process.exit(1);
    }

    // Fetch all posts
    const allPosts = await fetchAllPosts();

    // Find videos needing thumbnails
    const postsToProcess = findVideosNeedingThumbnails(allPosts);
    console.log(
      `\nFound ${postsToProcess.length} video posts needing thumbnails`,
    );

    if (postsToProcess.length === 0) {
      console.log("Nothing to do!");
      return;
    }

    // Process each post
    let successCount = 0;
    let failCount = 0;

    for (const post of postsToProcess) {
      const success = await processPost(post);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total processed: ${postsToProcess.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    if (DRY_RUN) {
      console.log("\nThis was a DRY RUN. No changes were made.");
      console.log("Run without DRY_RUN=true to apply changes.");
    }
  } catch (error) {
    console.error("\nFATAL ERROR:", error);
    process.exit(1);
  }
}

main();
