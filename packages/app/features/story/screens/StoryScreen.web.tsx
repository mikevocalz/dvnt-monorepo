"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import Stories from "react-insta-stories";

const HERO_VIDEO_SRC =
  "https://video.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/02368f0f-2bb0-4591-8831-9c099f3808f5/playlist.m3u8";
const HERO_POSTER_SRC =
  "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/c8070a27-5b5e-42f3-bb47-c8502dec8b1a/DVNT_social.png?format=1500w";
const DVNT_ICON_SRC =
  "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/9222cacc-a5d9-415d-bb63-0511c58ec455/DVNT-APP_icon_color+1024.png?format=750w";

const chapters = [
  {
    number: "00",
    kicker: "DVNT.APP",
    title: "connect. gather. move.",
    copy: "DVNT app exists to create an intentional space for queer people to connect, gather, and move culture on their own terms.",
    accent: "#7052FF",
    from: "#02030A",
    to: "#080414",
    image:
      DVNT_ICON_SRC,
    cards: ["Nightlife", "Community", "Curated access"],
  },
  {
    number: "01",
    kicker: "What is DVNT?",
    title: "A social platform for nightlife, community, and curated access.",
    copy: "A members-first app built around the rooms, recaps, events, private conversations, and profile signals that shape the culture.",
    accent: "#8A40CF",
    from: "#080414",
    to: "#050B18",
    image:
      "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/18ab2b60-ed92-4f3e-8444-d33a9a269269/DVNT+Phone+Mockup-FEED.png?format=1000w",
    cards: ["Curated posts", "Real updates", "Culture moves fast"],
  },
  {
    number: "02",
    kicker: "The conversation starts here.",
    title: "Your feed keeps up without the public performance.",
    copy: "Curated posts, recaps, and chatter from real people, not content farms. The room can move fast without becoming a stage.",
    accent: "#29DFFF",
    from: "#050B18",
    to: "#061018",
    image:
      "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/18ab2b60-ed92-4f3e-8444-d33a9a269269/DVNT+Phone+Mockup-FEED.png?format=1000w",
    cards: ["Recaps", "Chatter", "No content farms"],
  },
  {
    number: "03",
    kicker: "Your calendar just got dangerous.",
    title: "Discover what is happening and what is worth pulling up to.",
    copy: "From official parties to community nights, DVNT centers events that are curated, verified, and actually worth leaving the house for.",
    accent: "#CCFF00",
    from: "#061018",
    to: "#10060C",
    image:
      "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/8656172e-7af1-40c2-acb0-82c1d093ad24/DVNT+Phone+Mockup-EVENTS.png?format=1000w",
    cards: ["Discover", "RSVP", "Pull up"],
  },
  {
    number: "04",
    kicker: "Face-to-face. With no audience.",
    title: "Private messages and video for people you actually trust.",
    copy: "Keep it discreet. Keep it cute. Talk first, decide later, and leave the performance outside the room.",
    accent: "#FF4BFC",
    from: "#10060C",
    to: "#080414",
    image:
      "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/e8e4c473-c9da-44e5-a4dc-595b57bec392/DVNT+Phone+Mockup-VIDEO.png?format=1000w",
    cards: ["Private video", "Messages", "Discreet"],
  },
  {
    number: "05",
    kicker: "Access looks good on you.",
    title: "Your profile is not a resume. It is a signal.",
    copy: "Set your vibe. Control what is visible. Show what you want, hide what you do not, and let the right people find you.",
    accent: "#FF4B2F",
    from: "#080414",
    to: "#02030A",
    image:
      "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/3aa25ea5-6ce1-461e-bb54-4d09e852cdf8/DVNT+Phone+Mockup-PROFILE.png?format=1000w",
    cards: ["Vibe", "Visibility", "Signal"],
  },
];

const storyDeck = [
  {
    url: HERO_POSTER_SRC,
    duration: 4200,
    header: {
      heading: "DVNT",
      subheading: "connect. gather. move.",
      profileImage: DVNT_ICON_SRC,
    },
    styles: {
      objectFit: "cover",
    },
  },
  {
    url: "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/18ab2b60-ed92-4f3e-8444-d33a9a269269/DVNT+Phone+Mockup-FEED.png?format=1000w",
    duration: 3600,
    header: {
      heading: "Feed",
      subheading: "conversation starts here",
      profileImage: DVNT_ICON_SRC,
    },
    styles: {
      objectFit: "contain",
      background: "#05050A",
      padding: 24,
    },
  },
  {
    url: "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/8656172e-7af1-40c2-acb0-82c1d093ad24/DVNT+Phone+Mockup-EVENTS.png?format=1000w",
    duration: 3600,
    header: {
      heading: "Events",
      subheading: "calendar got dangerous",
      profileImage: DVNT_ICON_SRC,
    },
    styles: {
      objectFit: "contain",
      background: "#05050A",
      padding: 24,
    },
  },
  {
    url: "https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/3aa25ea5-6ce1-461e-bb54-4d09e852cdf8/DVNT+Phone+Mockup-PROFILE.png?format=1000w",
    duration: 3600,
    header: {
      heading: "Profile",
      subheading: "access looks good",
      profileImage: DVNT_ICON_SRC,
    },
    styles: {
      objectFit: "contain",
      background: "#05050A",
      padding: 24,
    },
  },
];

function getSectionStyle(chapter: (typeof chapters)[number]) {
  return {
    "--progress": 0,
    "--enter": 0,
    "--exit": 0,
    "--glow-opacity": 0.18,
    "--glow-x": "0px",
    "--glow-y": "0px",
    "--glow-scale": 0.82,
    "--texture-y": "0px",
    "--far-y": "0px",
    "--far-x": "0px",
    "--far-rotate": "0deg",
    "--video-scale": 1.08,
    "--mid-y": "0px",
    "--mid-x": "0px",
    "--mid-alt-y": "0px",
    "--mid-alt-x": "0px",
    "--near-y": "0px",
    "--near-x": "0px",
    "--near-alt-y": "0px",
    "--near-alt-x": "0px",
    "--content-opacity": 0.18,
    "--content-y": "72px",
    "--content-scale": 0.94,
    "--panel-opacity": 0.12,
    "--panel-y": "96px",
    "--panel-rx": "12deg",
    "--panel-ry": "5deg",
    "--image-rotate": "-3.5deg",
    "--orb-scale": 0.72,
    "--model-rotate": "45deg",
    "--model-y": "0px",
    "--inner-rotate": "45deg",
    "--inner-scale": 0.82,
    "--bento-0-y": "36px",
    "--bento-0-opacity": 0,
    "--bento-0-scale": 0.94,
    "--bento-1-y": "54px",
    "--bento-1-opacity": 0,
    "--bento-1-scale": 0.94,
    "--bento-2-y": "72px",
    "--bento-2-opacity": 0,
    "--bento-2-scale": 0.94,
    "--accent": chapter.accent,
    background: `linear-gradient(135deg, ${chapter.from}, ${chapter.to})`,
  } as never;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

async function resolveHeroVideoSource() {
  const response = await fetch(HERO_VIDEO_SRC, { cache: "no-store" });
  if (!response.ok) return HERO_VIDEO_SRC;

  const playlist = await response.text();
  const videoSources = [
    ...playlist.matchAll(
      /^https:\/\/video\.squarespace-cdn\.com\/.+\/segments\/mpegts-h264-(\d+):\d+\.m3u8\?[^\s]+$/gm,
    ),
  ];

  if (videoSources.length === 0) return HERO_VIDEO_SRC;

  const targetWidth =
    typeof window !== "undefined" && window.innerWidth >= 900 ? "1080" : "360";
  const targetSource =
    videoSources.find((source) => source[1] === targetWidth) ??
    videoSources[videoSources.length - 1];

  return targetSource[0];
}

function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<
    "loading" | "playing" | "blocked" | "error"
  >("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
    let hls: Hls | null = null;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    const play = () => {
      if (destroyed) return;
      video
        .play()
        .then(() => setStatus("playing"))
        .catch(() => setStatus("blocked"));
    };

    const onPlaying = () => setStatus("playing");
    const onError = () => setStatus("error");
    const onCanPlay = () => play();

    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    video.addEventListener("canplay", onCanPlay);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      resolveHeroVideoSource()
        .then((source) => {
          if (destroyed) return;
          video.src = source;
          play();
        })
        .catch(() => {
          if (destroyed) return;
          video.src = HERO_VIDEO_SRC;
          play();
        });
      return () => {
        destroyed = true;
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        video.removeEventListener("canplay", onCanPlay);
      };
    }

    if (!Hls.isSupported()) {
      window.setTimeout(() => setStatus("error"), 0);
      return () => {
        destroyed = true;
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        video.removeEventListener("canplay", onCanPlay);
      };
    }

    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      debug: false,
    });
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      resolveHeroVideoSource()
        .then((source) => {
          if (destroyed) return;
          hls?.loadSource(source);
        })
        .catch(() => {
          if (destroyed) return;
          hls?.loadSource(HERO_VIDEO_SRC);
        });
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      play();
    });
    hls.on(Hls.Events.ERROR, (_event: unknown, data: unknown) => {
      const error = data as { fatal?: boolean; type?: string };
      if (!error?.fatal) return;
      if (error.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls?.startLoad?.();
        return;
      }
      if (error.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls?.recoverMediaError?.();
        return;
      }
      setStatus("error");
    });
    hls.attachMedia(video);

    return () => {
      destroyed = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      video.removeEventListener("canplay", onCanPlay);
      hls?.destroy();
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        crossOrigin="anonymous"
        poster={HERO_POSTER_SRC}
        preload="auto"
      />
      {status !== "playing" ? (
        <div className="absolute bottom-6 left-6 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-white/70 backdrop-blur">
          Video {status}
        </div>
      ) : null}
    </>
  );
}

function StoryDeckPreview() {
  return (
    <section className="relative isolate overflow-hidden bg-[#05050A] px-6 py-28">
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle_at_20%_20%,white_0_1px,transparent_1px)] [background-size:34px_34px]" />
      <div className="absolute left-[-12rem] top-20 h-[30rem] w-[30rem] rounded-full bg-[#7052FF]/25 blur-3xl" />
      <div className="absolute right-[-10rem] bottom-0 h-[28rem] w-[28rem] rounded-full bg-[#29DFFF]/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_400px]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.32em] text-white/52">
            Story viewer
          </p>
          <h2 className="mt-5 max-w-3xl text-5xl font-black leading-none tracking-tight md:text-7xl">
            Tap through the DVNT story deck.
          </h2>
          <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-white/65">
            This panel is powered by react-insta-stories in the shared web
            screen. Tap left or right, hold to pause, or use arrow keys.
          </p>
        </div>

        <div className="mx-auto w-full max-w-[360px] rounded-[2rem] border border-white/15 bg-white/[0.07] p-3 shadow-2xl shadow-black/50">
          <div className="aspect-[9/16] overflow-hidden rounded-[1.55rem] bg-black">
            <Stories
              stories={storyDeck}
              defaultInterval={3600}
              width="100%"
              height="100%"
              keyboardNavigation
              loop
              storyContainerStyles={{
                background: "#05050A",
              }}
              progressContainerStyles={{
                paddingTop: 12,
                paddingLeft: 12,
                paddingRight: 12,
              }}
              progressWrapperStyles={{
                background: "rgba(255,255,255,0.22)",
                height: 3,
              }}
              progressStyles={{
                background: "#CCFF00",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function StoryScreen() {
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeChapter, setActiveChapter] = useState(0);

  useEffect(() => {
    let frame = 0;
    let lastActive = 0;

    const update = () => {
      frame = 0;
      const viewport = window.innerHeight || 1;
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      sectionRefs.current.forEach((section, index) => {
        if (!section) return;
        const rect = section.getBoundingClientRect();
        const progress = clamp(
          (viewport - rect.top) / (viewport + rect.height),
        );
        const enter = clamp((viewport * 0.78 - rect.top) / (viewport * 0.62));
        const exit = clamp((viewport * 0.2 - rect.top) / (viewport * 0.72));
        const distance = Math.abs(rect.top + rect.height * 0.42);

        section.style.setProperty("--progress", progress.toFixed(4));
        section.style.setProperty("--enter", enter.toFixed(4));
        section.style.setProperty("--exit", exit.toFixed(4));
        section.style.setProperty(
          "--glow-opacity",
          `${0.18 + progress * 0.48}`,
        );
        section.style.setProperty("--glow-x", `${progress * -140}px`);
        section.style.setProperty("--glow-y", `${progress * 90}px`);
        section.style.setProperty("--glow-scale", `${0.82 + progress * 0.45}`);
        section.style.setProperty("--texture-y", `${progress * -80}px`);
        section.style.setProperty("--far-y", `${progress * -54}px`);
        section.style.setProperty("--far-x", `${progress * 24}px`);
        section.style.setProperty("--far-rotate", `${progress * 24}deg`);
        section.style.setProperty("--video-scale", `${1.08 + progress * 0.08}`);
        section.style.setProperty("--mid-y", `${progress * -138}px`);
        section.style.setProperty("--mid-x", `${progress * -46}px`);
        section.style.setProperty("--mid-alt-y", `${progress * -110}px`);
        section.style.setProperty("--mid-alt-x", `${progress * 32}px`);
        section.style.setProperty("--near-y", `${progress * -228}px`);
        section.style.setProperty("--near-x", `${progress * 72}px`);
        section.style.setProperty("--near-alt-y", `${progress * -164}px`);
        section.style.setProperty("--near-alt-x", `${progress * -47}px`);
        section.style.setProperty(
          "--content-opacity",
          `${clamp(0.18 + enter * 0.82 - exit * 0.36)}`,
        );
        section.style.setProperty(
          "--content-y",
          `${(1 - enter) * 72 - exit * 42 + progress * -24}px`,
        );
        section.style.setProperty("--content-scale", `${0.94 + enter * 0.06}`);
        section.style.setProperty(
          "--panel-opacity",
          `${clamp(0.12 + enter * 0.88 - exit * 0.28)}`,
        );
        section.style.setProperty(
          "--panel-y",
          `${(1 - enter) * 96 + progress * -86}px`,
        );
        section.style.setProperty("--panel-rx", `${(1 - enter) * 12}deg`);
        section.style.setProperty("--panel-ry", `${progress * -10 + 5}deg`);
        section.style.setProperty("--image-rotate", `${progress * 7 - 3.5}deg`);
        section.style.setProperty("--orb-scale", `${0.72 + progress * 0.55}`);
        section.style.setProperty(
          "--model-rotate",
          `${45 + progress * 120}deg`,
        );
        section.style.setProperty("--model-y", `${progress * -18}px`);
        section.style.setProperty("--inner-rotate", `${45 - progress * 90}deg`);
        section.style.setProperty("--inner-scale", `${0.82 + enter * 0.22}`);
        for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
          section.style.setProperty(
            `--bento-${cardIndex}-y`,
            `${(1 - enter) * (36 + cardIndex * 18)}px`,
          );
          section.style.setProperty(
            `--bento-${cardIndex}-opacity`,
            `${clamp(enter - cardIndex * 0.12)}`,
          );
          section.style.setProperty(
            `--bento-${cardIndex}-scale`,
            `${0.94 + enter * 0.06}`,
          );
        }

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = index;
        }
      });

      if (nearest !== lastActive) {
        lastActive = nearest;
        setActiveChapter(nearest);
      }
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <div className="relative bg-[#02030A] text-white">
      <div className="fixed left-0 top-0 z-10 hidden h-screen w-1 bg-white/10 lg:block">
        <div
          className="w-full transition-transform duration-300"
          style={{
            height: `${100 / chapters.length}%`,
            backgroundColor: chapters[activeChapter].accent,
            transform: `translateY(${activeChapter * 100}%)`,
          }}
        />
      </div>

      {chapters.map((chapter, index) => (
        <section
          key={chapter.number}
          ref={(node) => {
            sectionRefs.current[index] = node;
          }}
          className="story-section relative isolate min-h-[140vh] overflow-hidden px-6 py-24"
          style={getSectionStyle(chapter)}
        >
          <div className="pointer-events-none sticky top-0 flex min-h-screen items-center">
            {index === 0 ? (
              <div
                className="absolute inset-0 z-0 opacity-100"
                style={{
                  transform:
                    "translate3d(var(--far-x), var(--far-y), 0) scale(var(--video-scale))",
                }}
              >
                <img
                  src={HERO_POSTER_SRC}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <HeroVideo />
              </div>
            ) : null}
            {index === 0 ? (
              <div className="absolute inset-0 z-[1] bg-gradient-to-r from-[#02030A]/80 via-[#02030A]/45 to-[#02030A]/10" />
            ) : null}
            <div
              className="absolute right-[-12rem] top-20 z-[2] h-[34rem] w-[34rem] rounded-full blur-3xl"
              style={{
                backgroundColor: `${chapter.accent}35`,
                opacity: "var(--glow-opacity)",
                transform:
                  "translate3d(var(--glow-x), var(--glow-y), 0) scale(var(--glow-scale))",
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 20%, white 0 1px, transparent 1px)",
                backgroundSize: "34px 34px",
                transform: "translateY(var(--texture-y))",
              }}
            />
            <div
              className="absolute left-[-10rem] top-16 h-96 w-96 rounded-full border border-white/10"
              style={{
                transform:
                  "translate3d(var(--far-x), var(--far-y), 0) rotate(var(--far-rotate))",
              }}
            />
            <div
              className="absolute bottom-24 left-[8%] h-56 w-80 rounded-lg border border-white/10 bg-white/[0.035] blur-[0.2px]"
              style={{
                transform:
                  "translate3d(var(--mid-x), var(--mid-y), 0) rotate(-9deg)",
              }}
            />
            <div
              className="absolute right-[18%] top-20 h-40 w-72 rounded-lg border border-white/10 bg-white/[0.045]"
              style={{
                transform:
                  "translate3d(var(--mid-alt-x), var(--mid-alt-y), 0) rotate(12deg)",
              }}
            />
            <div
              className="absolute bottom-16 right-[10%] h-px w-72 bg-gradient-to-r from-transparent via-white/45 to-transparent"
              style={{
                transform:
                  "translate3d(var(--near-x), var(--near-y), 0) rotate(-18deg)",
              }}
            />
            <div
              className="absolute left-[30%] top-28 h-px w-52 bg-gradient-to-r from-transparent via-white/35 to-transparent"
              style={{
                transform:
                  "translate3d(var(--near-alt-x), var(--near-alt-y), 0) rotate(24deg)",
              }}
            />

            <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1fr_430px]">
              <div
                style={{
                  opacity: "var(--content-opacity)",
                  transform:
                    "translateY(var(--content-y)) scale(var(--content-scale))",
                }}
              >
                <div className="mb-6 flex items-center gap-3">
                  <span
                    className="grid h-10 w-10 place-items-center rounded-full border text-sm font-black"
                    style={{
                      borderColor: chapter.accent,
                      color: chapter.accent,
                    }}
                  >
                    {chapter.number}
                  </span>
                  <span className="text-xs font-black uppercase tracking-[0.28em] text-white/60">
                    {chapter.kicker}
                  </span>
                </div>
                <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">
                  {chapter.title}
                </h1>
                <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-white/68">
                  {chapter.copy}
                </p>
              </div>

              <div
                className="relative rounded-lg border border-white/12 bg-white/[0.07] p-4 shadow-2xl shadow-black/40 backdrop-blur"
                style={{
                  opacity: "var(--panel-opacity)",
                  transform:
                    "perspective(1000px) translateY(var(--panel-y)) rotateX(var(--panel-rx)) rotateY(var(--panel-ry))",
                }}
              >
                {index === 2 ? (
                  <div className="grid gap-3">
                    {chapter.cards.map((label, cardIndex) => (
                      <div
                        key={label}
                        className="rounded-lg border border-white/12 bg-white/[0.08] p-5"
                        style={{
                          transform: `translateY(var(--bento-${cardIndex}-y)) scale(var(--bento-${cardIndex}-scale))`,
                          opacity: `var(--bento-${cardIndex}-opacity)`,
                        }}
                      >
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-white/48">
                          {label}
                        </p>
                        <p className="mt-5 text-2xl font-black">
                          {cardIndex === 0
                            ? "Curated posts, recaps, and room chatter."
                            : cardIndex === 1
                              ? "Real updates from real people."
                              : "Culture moves fast. Your feed keeps up."}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="relative grid aspect-square place-items-center overflow-hidden rounded-lg bg-black/30">
                    <div
                      className="absolute h-64 w-64 rounded-full blur-3xl"
                      style={{
                        backgroundColor: `${chapter.accent}38`,
                        transform: "scale(var(--orb-scale))",
                      }}
                    />
                    <img
                      src={chapter.image}
                      alt=""
                      className="relative z-10 max-h-[82%] max-w-[78%] object-contain drop-shadow-2xl"
                      style={{
                        transform:
                          "translateY(var(--model-y)) rotate(var(--image-rotate)) scale(var(--inner-scale))",
                      }}
                    />
                    <div
                      className="absolute h-40 w-40 rounded-3xl border bg-white/10"
                      style={{
                        borderColor: chapter.accent,
                        transform:
                          "rotate(var(--inner-rotate)) scale(var(--inner-scale))",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      ))}

      <StoryDeckPreview />

      <section className="relative isolate overflow-hidden bg-[#02030A] px-6 py-28 text-center">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="absolute left-1/2 top-10 h-96 w-96 -translate-x-1/2 rounded-full bg-[#8A40CF]/25 blur-3xl" />
        <div className="relative mx-auto max-w-4xl">
          <p className="text-xs font-black uppercase tracking-[0.32em] text-white/52">
            DVNT.APP
          </p>
          <h2 className="mt-5 text-5xl font-black leading-none tracking-tight md:text-7xl">
            Download now.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-8 text-white/65">
            Join the social platform for nightlife, community, and curated
            access.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <img
              src="https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/984f791e-38da-4c97-bd3d-257a488a1f30/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.png?format=500w"
              alt="Download on the App Store"
              className="h-12 w-auto"
            />
            <img
              src="https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/f87f69fd-f310-43b4-a8e7-7ba38246bee0/GetItOnGooglePlay_Badge_Web_color_English.png?format=500w"
              alt="Get it on Google Play"
              className="h-12 w-auto"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
