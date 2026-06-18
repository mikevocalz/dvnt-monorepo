/**
 * Native renderer for a Payload Lexical editor state (the blog post body).
 *
 * The web renders this with Payload's official Lexical→React converter; native
 * has no such converter, so this walks the same node tree and maps the common
 * nodes to React Native primitives: headings, paragraphs, formatted text,
 * lists, quotes, links, horizontal rules and uploaded images. The editorial
 * custom blocks (pullQuote, divider, sideNote, faq, statBlock, videoEmbed, …)
 * get sensible native treatments; any unknown block degrades gracefully rather
 * than crashing the reader.
 */
import { Fragment } from "react";
import { Linking, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { blogMediaUrl, type BlogMedia } from "@dvnt/app/lib/api/blog";

// Palette — matches the app's dark editorial surface.
const C = {
  fg: "#f5f5f4",
  muted: "#a3a3a3",
  faint: "#737373",
  purple: "#C084FC",
  cyan: "#3FDCFF",
  hairline: "rgba(255,255,255,0.10)",
  panel: "rgba(255,255,255,0.04)",
};

// Lexical text format bitmask.
const FMT = { bold: 1, italic: 2, strike: 4, underline: 8, code: 16 };

type Node = any;

function openLink(url?: string) {
  if (!url) return;
  Linking.openURL(url).catch(() => {});
}

/** Inline text / link / linebreak nodes — rendered inside a parent <Text>. */
function Inline({ node, router }: { node: Node; router: ReturnType<typeof useRouter> }) {
  if (!node) return null;

  if (node.type === "linebreak") return <Text>{"\n"}</Text>;

  if (node.type === "text") {
    const f = node.format ?? 0;
    return (
      <Text
        style={{
          fontWeight: f & FMT.bold ? "700" : undefined,
          fontStyle: f & FMT.italic ? "italic" : undefined,
          textDecorationLine:
            f & FMT.underline && f & FMT.strike
              ? "underline line-through"
              : f & FMT.underline
                ? "underline"
                : f & FMT.strike
                  ? "line-through"
                  : undefined,
          fontFamily: f & FMT.code ? "Courier" : undefined,
          color: f & FMT.code ? C.cyan : undefined,
        }}
      >
        {node.text}
      </Text>
    );
  }

  if (node.type === "link" || node.type === "autolink") {
    const fields = node.fields ?? {};
    const doc = fields.doc?.value;
    const internalSlug =
      fields.linkType === "internal" && doc && typeof doc === "object"
        ? doc.slug
        : undefined;
    const url = fields.url;
    return (
      <Text
        style={{ color: C.cyan, textDecorationLine: "underline" }}
        onPress={() =>
          internalSlug
            ? router.push(`/(protected)/blog/${internalSlug}` as never)
            : openLink(url)
        }
      >
        {(node.children ?? []).map((c: Node, i: number) => (
          <Inline key={i} node={c} router={router} />
        ))}
      </Text>
    );
  }

  // Fallback: render any text children inline.
  return (
    <>
      {(node.children ?? []).map((c: Node, i: number) => (
        <Inline key={i} node={c} router={router} />
      ))}
    </>
  );
}

/** Wrap inline children in a single <Text>. */
function InlineText({
  children,
  style,
  router,
}: {
  children: Node[];
  style?: any;
  router: ReturnType<typeof useRouter>;
}) {
  if (!children?.length) return null;
  return (
    <Text style={style}>
      {children.map((c, i) => (
        <Inline key={i} node={c} router={router} />
      ))}
    </Text>
  );
}

const HEADING_STYLE: Record<string, any> = {
  h1: { fontSize: 30, fontWeight: "800", lineHeight: 36, marginTop: 28, marginBottom: 10 },
  h2: { fontSize: 24, fontWeight: "800", lineHeight: 30, marginTop: 24, marginBottom: 8 },
  h3: { fontSize: 20, fontWeight: "700", lineHeight: 26, marginTop: 20, marginBottom: 6 },
  h4: { fontSize: 17, fontWeight: "700", lineHeight: 23, marginTop: 16, marginBottom: 6 },
};

function CustomBlock({ node, router }: { node: Node; router: ReturnType<typeof useRouter> }) {
  const f = node.fields ?? {};
  switch (f.blockType) {
    case "divider":
      return <View style={{ height: 1, backgroundColor: C.hairline, marginVertical: 24 }} />;

    case "pullQuote":
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: C.purple,
            paddingLeft: 16,
            paddingVertical: 6,
            marginVertical: 20,
          }}
        >
          <Text style={{ color: C.fg, fontSize: 22, fontWeight: "700", lineHeight: 30, fontStyle: "italic" }}>
            {f.quote}
          </Text>
          {f.attribution ? (
            <Text style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>— {f.attribution}</Text>
          ) : null}
        </View>
      );

    case "sideNote":
      return (
        <View
          style={{
            backgroundColor: C.panel,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.hairline,
            padding: 14,
            marginVertical: 16,
          }}
        >
          {f.label ? (
            <Text style={{ color: C.cyan, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
              {f.label}
            </Text>
          ) : null}
          <Text style={{ color: C.muted, fontSize: 15, lineHeight: 22 }}>{f.text ?? f.content}</Text>
        </View>
      );

    case "statBlock":
      return (
        <View style={{ alignItems: "center", marginVertical: 20 }}>
          <Text style={{ color: C.purple, fontSize: 40, fontWeight: "900" }}>{f.value ?? f.stat}</Text>
          {f.label ? (
            <Text style={{ color: C.muted, fontSize: 14, marginTop: 4, textAlign: "center" }}>{f.label}</Text>
          ) : null}
        </View>
      );

    case "faq":
      return (
        <View style={{ marginVertical: 12 }}>
          {(f.items ?? []).map((it: any, i: number) => (
            <View key={i} style={{ marginBottom: 14 }}>
              <Text style={{ color: C.fg, fontSize: 16, fontWeight: "700", marginBottom: 4 }}>{it.question}</Text>
              <Text style={{ color: C.muted, fontSize: 15, lineHeight: 22 }}>{it.answer}</Text>
            </View>
          ))}
        </View>
      );

    case "videoEmbed":
      return (
        <Text
          onPress={() => openLink(f.url)}
          style={{
            color: C.cyan,
            textDecorationLine: "underline",
            fontSize: 15,
            marginVertical: 16,
          }}
        >
          ▶ Watch video
        </Text>
      );

    case "sponsoredDisclosure":
      return (
        <Text style={{ color: C.faint, fontSize: 12, fontStyle: "italic", marginVertical: 12 }}>
          {f.text ?? "Sponsored content"}
        </Text>
      );

    default:
      // appCta / newsletterCta / eventCallout / timeline / imageGallery /
      // relatedPostsBlock — not yet rendered natively; skip rather than crash.
      return null;
  }
}

function Block({ node, router }: { node: Node; router: ReturnType<typeof useRouter> }) {
  if (!node) return null;
  const children: Node[] = node.children ?? [];

  switch (node.type) {
    case "heading": {
      const tag = node.tag ?? "h2";
      return (
        <InlineText style={[{ color: C.fg }, HEADING_STYLE[tag] ?? HEADING_STYLE.h2]} router={router}>
          {children}
        </InlineText>
      );
    }

    case "paragraph":
      if (!children.length) return <View style={{ height: 10 }} />;
      return (
        <InlineText
          style={{ color: C.fg, fontSize: 17, lineHeight: 27, marginBottom: 16 }}
          router={router}
        >
          {children}
        </InlineText>
      );

    case "quote":
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: C.hairline, paddingLeft: 16, marginVertical: 16 }}>
          <InlineText
            style={{ color: C.muted, fontSize: 18, lineHeight: 27, fontStyle: "italic" }}
            router={router}
          >
            {children}
          </InlineText>
        </View>
      );

    case "list": {
      const ordered = node.listType === "number";
      return (
        <View style={{ marginBottom: 16, gap: 6 }}>
          {children.map((li: Node, i: number) => (
            <View key={i} style={{ flexDirection: "row", paddingRight: 8 }}>
              <Text style={{ color: C.purple, fontSize: 17, lineHeight: 27, width: 26 }}>
                {ordered ? `${i + 1}.` : "•"}
              </Text>
              <InlineText
                style={{ color: C.fg, fontSize: 17, lineHeight: 27, flex: 1 }}
                router={router}
              >
                {li.children ?? []}
              </InlineText>
            </View>
          ))}
        </View>
      );
    }

    case "horizontalrule":
      return <View style={{ height: 1, backgroundColor: C.hairline, marginVertical: 24 }} />;

    case "upload": {
      const media: BlogMedia | undefined = node.value
        ? {
            id: String(node.value.id ?? ""),
            url: node.value.url ?? "",
            alt: node.value.alt,
            width: node.value.width,
            height: node.value.height,
          }
        : undefined;
      const uri = blogMediaUrl(media, "full");
      if (!uri) return null;
      const ratio = media?.width && media?.height ? media.width / media.height : 16 / 9;
      const caption = node.fields?.caption;
      return (
        <View style={{ marginVertical: 18 }}>
          <Image
            source={{ uri }}
            style={{ width: "100%", aspectRatio: ratio, borderRadius: 12, backgroundColor: "#111" }}
            contentFit="cover"
          />
          {caption ? (
            <Text style={{ color: C.faint, fontSize: 13, marginTop: 8, textAlign: "center" }}>{caption}</Text>
          ) : null}
        </View>
      );
    }

    case "block":
      return <CustomBlock node={node} router={router} />;

    default:
      // Unknown container — try to render its children as blocks.
      if (children.length) {
        return (
          <>
            {children.map((c: Node, i: number) => (
              <Block key={i} node={c} router={router} />
            ))}
          </>
        );
      }
      return null;
  }
}

export function BlogContent({ content }: { content: unknown }) {
  const router = useRouter();
  const root = (content as any)?.root;
  const children: Node[] = root?.children ?? [];
  if (!children.length) return null;
  return (
    <View>
      {children.map((node, i) => (
        <Fragment key={i}>
          <Block node={node} router={router} />
        </Fragment>
      ))}
    </View>
  );
}
