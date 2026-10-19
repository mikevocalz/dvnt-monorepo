import { test } from "node:test";
import { URL } from "node:url";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createFeedAudioCoordinator,
  isFeedCellVisible,
  syncFeedPlayer,
} from "./native-feed-playback.ts";

function mockPlayer() {
  return {
    muted: true,
    audioMixingMode: "mixWithOthers" as "mixWithOthers" | "duckOthers",
    playing: false,
    currentTime: 0,
    play() {
      this.playing = true;
    },
    pause() {
      this.playing = false;
    },
    tick(seconds: number) {
      if (this.playing) this.currentTime += seconds;
    },
  };
}

test("visible feed video advances; leaving viewport, focus or foreground pauses it", () => {
  for (const reason of ["viewport", "route blur", "background"]) {
    const player = mockPlayer();
    syncFeedPlayer(player, true, true);
    player.tick(2);
    assert.equal(player.currentTime, 2, reason);
    assert.equal(player.muted, true);
    syncFeedPlayer(player, false, false);
    player.tick(2);
    assert.equal(player.currentTime, 2, reason);
    assert.equal(player.muted, true);
    assert.equal(player.audioMixingMode, "mixWithOthers");
    syncFeedPlayer(player, true, true);
    player.tick(1);
    assert.equal(player.currentTime, 3, reason);
  }
});

test("explicit unmute takes sound ownership without simultaneous audio", () => {
  const first = mockPlayer();
  const second = mockPlayer();
  syncFeedPlayer(first, true, false);
  assert.equal(first.muted, false);
  assert.equal(first.audioMixingMode, "duckOthers");
  syncFeedPlayer(second, true, false);
  assert.equal(first.muted, true);
  assert.equal(first.audioMixingMode, "mixWithOthers");
  assert.equal(second.muted, false);
  assert.equal(first.playing, true, "the previous tile keeps moving silently");
  syncFeedPlayer(second, false, false);
});

test("carousel transition stops old time before starting the next slide", () => {
  const first = mockPlayer();
  const second = mockPlayer();
  syncFeedPlayer(first, true, false);
  first.tick(1);
  syncFeedPlayer(first, false, false);
  syncFeedPlayer(second, true, true);
  first.tick(5);
  second.tick(5);
  assert.equal(first.currentTime, 1);
  assert.equal(second.currentTime, 5);
  assert.equal(first.muted, true);
});

test("sound toggles preserve the current playback position", () => {
  const player = mockPlayer();
  syncFeedPlayer(player, true, true);
  player.tick(12);
  // React runs the pause-only effect cleanup before applying the mute change.
  player.pause();
  syncFeedPlayer(player, true, false);
  assert.equal(player.currentTime, 12);
  player.tick(1);
  player.pause();
  syncFeedPlayer(player, true, true);
  assert.equal(player.currentTime, 13);
});

test("audio handoff tolerates an already released native player", () => {
  const audio = createFeedAudioCoordinator();
  const released = mockPlayer();
  audio.claim(released);
  Object.defineProperty(released, "muted", {
    set() {
      throw new Error("released");
    },
  });
  assert.doesNotThrow(() => audio.claim(mockPlayer()));
  assert.doesNotThrow(() => audio.release(released));
});

test("tile visibility uses the list viewport, including partial and oversized cells", () => {
  assert.equal(isFeedCellVisible(100, 200, 100, 600), true);
  assert.equal(isFeedCellVisible(550, 200, 100, 600), false);
  assert.equal(isFeedCellVisible(500, 200, 100, 600), true);
  assert.equal(isFeedCellVisible(-200, 200, 100, 600), false);
  assert.equal(isFeedCellVisible(650, 200, 100, 600), false);
  assert.equal(isFeedCellVisible(-100, 1000, 100, 600), true);
  assert.equal(isFeedCellVisible(100, 0, 100, 600), false);
});

test("renderers wire player slots and native lifecycle rather than thumbnail-only playback", () => {
  const classic = readFileSync(
    new URL("./feed-post.tsx", import.meta.url),
    "utf8",
  );
  const masonry = readFileSync(
    new URL("./masonry-feed.tsx", import.meta.url),
    "utf8",
  );
  const inline = readFileSync(
    new URL("./feed-inline-video.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    classic,
    /videoSlot=\{medium.type === "video" && isActivePost && isFocused && index === currentSlide/,
  );
  assert.match(classic, /const isFocused = useFeedPlaybackEnabled\(\)/);
  assert.doesNotMatch(classic, /cleanupPlayer\(/, "mute changes must not rewind playback");
  assert.match(classic, /syncFeedPlayer\(player, isFocused && isActivePost, isMuted\)/);
  assert.match(masonry, /isVideo && isPlaying && media\?\.url/);
  assert.match(masonry, /measureInWindow/);
  assert.match(inline, /AppState.addEventListener\("change"/);
  assert.match(inline, /syncFeedPlayer\(player, enabled && isPlaying, muted\)/);
});

// Execute the component with a minimal hook host and mocked native modules.
// This exercises its real effects/handlers without pretending to decode media.
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { feedAudio } from "./native-feed-playback.ts";
const require = createRequire(import.meta.url);

test("inline component pauses on background/blur, resumes, unmutes and cleans up", () => {
  const ts = require("typescript");
  const source = readFileSync(
    new URL("./feed-inline-video.tsx", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const slots: any[] = [];
  let cursor = 0;
  let dirty = false;
  let pending: (() => void)[] = [];
  let focused = true;
  let appListener: ((state: string) => void) | undefined;
  const muteListeners = new Set<(event: { muted: boolean }) => void>();
  const player = mockPlayer();
  let muted = true;
  Object.defineProperty(player, "muted", {
    get: () => muted,
    set: (next) => {
      if (next === muted) return;
      muted = next;
      muteListeners.forEach((listener) => listener({ muted: next }));
    },
  });
  Object.assign(player, {
    addListener: (_name: string, listener: any) => {
      muteListeners.add(listener);
      return { remove: () => muteListeners.delete(listener) };
    },
  });
  let configured = false;
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({
      type,
      props: props ?? {},
      children,
    }),
    useState(initial: any) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [
        slots[index].value,
        (value: any) => {
          const next =
            typeof value === "function" ? value(slots[index].value) : value;
          if (next !== slots[index].value) {
            slots[index].value = next;
            dirty = true;
          }
        },
      ];
    },
    useEffect(effect: () => any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i])))
        return;
      pending.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const native = {
    View: "View",
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: {} },
    AppState: {
      currentState: "active",
      addEventListener: (_name: string, listener: any) => {
        appListener = listener;
        return {
          remove: () => {
            appListener = undefined;
          },
        };
      },
    },
  };
  const exports: any = {};
  runInNewContext(js, {
    exports,
    React: react,
    require(name: string) {
      if (name === "react") return react;
      if (name === "react-native") return native;
      if (name === "@react-navigation/native")
        return { useIsFocused: () => focused };
      if (name === "expo-video")
        return {
          VideoView: "VideoView",
          useVideoPlayer: (_uri: string, setup: any) => {
            if (!configured) {
              configured = true;
              setup(player);
            }
            return player;
          },
        };
      if (name === "lucide-react-native")
        return { Volume2: "Volume2", VolumeX: "VolumeX" };
      if (name === "./native-feed-playback")
        return { feedAudio, syncFeedPlayer };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  let tree: any;
  function render() {
    let loops = 0;
    do {
      assert.ok(++loops < 20, "effects settle without a render loop");
      dirty = false;
      cursor = 0;
      pending = [];
      tree = exports.FeedInlineVideo({
        uri: "https://example.com/video.mp4",
        isPlaying: true,
      });
      pending.forEach((effect) => effect());
    } while (dirty);
  }
  render();
  player.tick(1);
  assert.equal(player.currentTime, 1);
  assert.equal(player.muted, true);
  const button = tree.children.find((child: any) => child.type === "Pressable");
  let stoppedPropagation = false;
  button.props.onPress({
    stopPropagation: () => {
      stoppedPropagation = true;
    },
  });
  render();
  assert.equal(stoppedPropagation, true);
  assert.equal(player.muted, false);
  appListener!("background");
  render();
  player.tick(2);
  assert.equal(player.currentTime, 1);
  assert.equal(player.muted, true);
  appListener!("active");
  render();
  player.tick(2);
  assert.equal(player.currentTime, 3);
  focused = false;
  render();
  player.tick(2);
  assert.equal(player.currentTime, 3);
  focused = true;
  render();
  assert.equal(player.playing, true);
  slots.forEach((slot) => slot.cleanup?.());
  assert.equal(player.playing, false);
  assert.equal(appListener, undefined);
  assert.equal(muteListeners.size, 0);
});
