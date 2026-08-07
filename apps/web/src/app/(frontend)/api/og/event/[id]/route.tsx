/** @jsxImportSource react */
// ^ the app-wide jsxImportSource is nativewind (RNW interop); this route's
// JSX is satori markup for next/og, which must compile against plain React.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import {
  fetchShareEvent,
  formatShareDate,
  isShareableEvent,
  pickShareImage,
  shareVenue,
} from "../_lib/event-og";

/**
 * Per-event themed OG card (WS-7 share moment) — 1200×630, dark-luxury per
 * docs/dvnt-design-system.md: ink-deep base, flyer art behind a steep bottom
 * scrim ("The Door"), Space Grotesk title, Space Mono date, Inter venue, and
 * the Deviant Gradient spent once as the bottom hairline. Private / draft /
 * missing events get the generic brand card — no data leaks into unfurls.
 *
 * URL shape: /api/og/event/{id}?v={updated_at}  (v = cache-buster set by
 * generateMetadata; a versioned URL is cached effectively forever).
 */

export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

// Design tokens (docs/dvnt-design-system.md §1)
const INK_DEEP = "#02030A";
const TEXT_DIM = "rgba(255,255,255,0.60)";
const TEXT_FAINT = "rgba(255,255,255,0.40)";
const HAIRLINE = "rgba(255,255,255,0.10)";
const GRADIENT =
  "linear-gradient(100deg, #3FDCFF 0%, #8A40CF 52%, #FF5BFC 100%)";

// ---------------------------------------------------------------------------
// Fonts — the design system's installed faces, colocated in ../_fonts.
// Best-effort: if the files aren't readable at runtime the card falls back
// to next/og's built-in sans (no new deps, never a 500 over typography).

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

async function loadFonts(): Promise<OgFont[]> {
  const dir = join(
    process.cwd(),
    "src/app/(frontend)/api/og/_fonts",
  );
  const wanted: Array<[string, string, 400 | 700]> = [
    ["Space Grotesk", "SpaceGrotesk-Bold.ttf", 700],
    ["Inter", "Inter-Regular.ttf", 400],
    ["Space Mono", "SpaceMono-Regular.ttf", 400],
  ];
  const fonts: OgFont[] = [];
  for (const [name, file, weight] of wanted) {
    try {
      const buf = await readFile(join(dir, file));
      fonts.push({
        name,
        data: buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer,
        weight,
        style: "normal",
      });
    } catch {
      /* missing font → satori default face */
    }
  }
  return fonts;
}

function fontFamily(fonts: OgFont[], name: string): string | undefined {
  return fonts.some((f) => f.name === name) ? name : undefined;
}

// ---------------------------------------------------------------------------
// Cards

/** Generic brand card — also the private/draft/missing answer. */
function BrandCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: INK_DEEP,
        backgroundImage:
          "radial-gradient(circle at 18% 12%, rgba(63,220,255,0.14) 0%, rgba(63,220,255,0) 46%)," +
          "radial-gradient(circle at 82% 24%, rgba(255,91,252,0.12) 0%, rgba(255,91,252,0) 44%)," +
          "radial-gradient(circle at 50% 96%, rgba(138,64,207,0.20) 0%, rgba(138,64,207,0) 52%)",
      }}
    >
      <div
        style={{
          fontFamily: "Space Grotesk",
          fontSize: 132,
          fontWeight: 700,
          color: "#FFFFFF",
          letterSpacing: "0.06em",
        }}
      >
        DVNT
      </div>
      <div
        style={{
          fontFamily: "Space Mono",
          fontSize: 30,
          color: TEXT_DIM,
          marginTop: 18,
          letterSpacing: "0.08em",
        }}
      >
        connect. gather. move.
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 8,
          backgroundImage: GRADIENT,
        }}
      />
    </div>
  );
}

function EventCard({
  title,
  dateLine,
  venue,
  flyer,
}: {
  title: string;
  dateLine: string;
  venue: string;
  flyer: string | null;
}) {
  const shownTitle =
    title.length > 72 ? `${title.slice(0, 71).trimEnd()}…` : title;
  const titleSize = shownTitle.length > 44 ? 56 : shownTitle.length > 24 ? 68 : 80;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundColor: INK_DEEP,
      }}
    >
      {/* Flyer art full-bleed; generated gradient wash when there's none —
          "never an empty box" (design system §4). */}
      {flyer ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={flyer}
          alt=""
          width={WIDTH}
          height={HEIGHT}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundImage:
              "radial-gradient(circle at 20% 10%, rgba(63,220,255,0.20) 0%, rgba(63,220,255,0) 48%)," +
              "radial-gradient(circle at 85% 30%, rgba(255,91,252,0.16) 0%, rgba(255,91,252,0) 46%)," +
              "radial-gradient(circle at 55% 100%, rgba(138,64,207,0.28) 0%, rgba(138,64,207,0) 55%)",
          }}
        />
      )}

      {/* Steep bottom scrim — the flyer stays "the door", the text stays legible. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundImage:
            "linear-gradient(180deg, rgba(2,3,10,0.30) 0%, rgba(2,3,10,0.42) 40%, rgba(2,3,10,0.96) 100%)",
        }}
      />

      {/* Wordmark + eyebrow */}
      <div
        style={{
          position: "absolute",
          top: 44,
          left: 56,
          display: "flex",
          alignItems: "baseline",
          gap: 20,
        }}
      >
        <div
          style={{
            fontFamily: "Space Grotesk",
            fontSize: 40,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "0.06em",
          }}
        >
          DVNT
        </div>
        <div
          style={{
            fontFamily: "Space Mono",
            fontSize: 22,
            color: TEXT_FAINT,
            letterSpacing: "0.24em",
          }}
        >
          EVENT
        </div>
      </div>

      {/* Title + meta over the scrim */}
      <div
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          bottom: 64,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {dateLine ? (
          <div
            style={{
              fontFamily: "Space Mono",
              fontSize: 28,
              color: "#3FDCFF",
              letterSpacing: "0.10em",
              marginBottom: 14,
            }}
          >
            {dateLine.toUpperCase()}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: "Space Grotesk",
            fontSize: titleSize,
            fontWeight: 700,
            color: "#FFFFFF",
            lineHeight: 1.05,
            letterSpacing: "0.01em",
          }}
        >
          {shownTitle.toUpperCase()}
        </div>
        {venue ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: 18,
              fontFamily: "Inter",
              fontSize: 30,
              color: TEXT_DIM,
            }}
          >
            {venue}
          </div>
        ) : null}
      </div>

      {/* The one gradient stroke — bottom hairline. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 8,
          backgroundImage: GRADIENT,
        }}
      />
      {/* faint top hairline keeps the card from bleeding into white feeds */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 2,
          backgroundColor: HAIRLINE,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const versioned = new URL(req.url).searchParams.has("v");

  const [event, fonts] = await Promise.all([
    fetchShareEvent(id),
    loadFonts(),
  ]);

  const imageOpts = {
    width: WIDTH,
    height: HEIGHT,
    fonts: fonts.length > 0 ? fonts : undefined,
  };

  // Private / draft / suspended / missing → the brand card, cached briefly.
  if (!isShareableEvent(event)) {
    return new ImageResponse(<BrandCard />, {
      ...imageOpts,
      headers: {
        "Cache-Control":
          "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }

  // Versioned URLs (v = updated_at, set by generateMetadata) are immutable;
  // bare URLs revalidate hourly so event edits propagate.
  const cacheControl = versioned
    ? "public, s-maxage=31536000, immutable"
    : "public, s-maxage=3600, stale-while-revalidate=86400";

  return new ImageResponse(
    (
      <EventCard
        title={event.title || "DVNT event"}
        dateLine={formatShareDate(event)}
        venue={shareVenue(event)}
        flyer={pickShareImage(event)}
      />
    ),
    {
      ...imageOpts,
      headers: { "Cache-Control": cacheControl },
    },
  );
}
