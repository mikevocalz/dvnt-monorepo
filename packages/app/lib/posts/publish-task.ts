import type {
  PublishDescriptor,
  PublishMediaFile,
  PublishTask,
  PublishUploadedMedia,
} from "./publish-descriptor.ts";

export type PublishUploadOutcome = PublishUploadedMedia | { error: string };

export interface PublishCreatePostInput {
  operationId: string;
  expectedAuthorId: string;
  kind: "text" | "media";
  textTheme: PublishDescriptor["textTheme"];
  content: string;
  slides?: string[];
  location: string;
  isNSFW: boolean;
  media: PublishUploadedMedia[];
}

export interface PublishTaskDeps {
  /** Signed-in account id, or null when signed out. */
  currentOwnerId: () => string | null;
  /** Copy a picked file into app storage. Throws when the source is gone. */
  persistMedia: (file: PublishMediaFile) => Promise<PublishMediaFile>;
  uploadMedia: (
    files: PublishMediaFile[],
    report: (message: string) => void,
  ) => Promise<PublishUploadOutcome[]>;
  createPost: (
    input: PublishCreatePostInput,
  ) => Promise<{ id?: string | number } | null | undefined>;
  addPlacedTags: (postId: string, tags: PublishDescriptor["placedTags"]) => void;
}

const failed = (
  result: PublishUploadOutcome | undefined,
): result is { error: string } => Boolean(result && "error" in result);

/**
 * Rebuild the work for a descriptor. The same factory serves a fresh enqueue
 * and a job restored from storage, so resumed work runs the identical path.
 */
export function createPublishTask(
  descriptor: PublishDescriptor,
  ownerId: string,
  deps: PublishTaskDeps,
): PublishTask {
  return async (report, save) => {
    const assertOwner = () => {
      if (deps.currentOwnerId() !== ownerId) {
        throw new Error(
          "Sign back into the account that started this post to retry.",
        );
      }
    };
    let job = descriptor;
    assertOwner();
    if (job.postKind === "media") {
      // Copy anything still sitting on a picker URI into app storage first, so
      // the next launch can find it. Throws with the real reason when it's gone.
      const files = await Promise.all(
        job.files.map((file, index) =>
          job.uploaded[index] ? file : deps.persistMedia(file),
        ),
      );
      job = { ...job, files };
      save(job);
      const pending = files.flatMap((_, index) =>
        job.uploaded[index] ? [] : [index],
      );
      if (pending.length) {
        const results = await deps.uploadMedia(
          pending.map((index) => files[index]),
          report,
        );
        const uploaded = [...job.uploaded];
        pending.forEach((index, at) => {
          const result = results[at];
          uploaded[index] = result && !failed(result) ? result : null;
        });
        job = { ...job, uploaded };
        save(job);
        const rejected = results.find(failed);
        if (rejected && "error" in rejected) throw new Error(rejected.error);
      }
      if (files.some((_, index) => !job.uploaded[index])) {
        throw new Error("Media upload failed. Try again.");
      }
    }
    assertOwner();
    report("Publishing your post…");
    const post = await deps.createPost({
      operationId: job.operationId,
      expectedAuthorId: ownerId,
      kind: job.postKind,
      textTheme: job.textTheme,
      content: job.content,
      slides: job.postKind === "text" ? job.slides : undefined,
      location: job.location,
      isNSFW: job.isNSFW,
      media: job.uploaded.filter((media) => media !== null),
    });
    if (job.postKind === "media" && post?.id && job.placedTags.length) {
      // A tag failure must never mark an already-created post as retryable.
      try {
        deps.addPlacedTags(String(post.id), job.placedTags);
      } catch (error) {
        console.warn("[PublishPost] People tags could not be saved", error);
      }
    }
  };
}
