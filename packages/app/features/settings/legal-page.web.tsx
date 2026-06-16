"use client";

import { useMemo } from "react";
import { useRouter } from "solito/navigation";
import { ChevronDown, X } from "lucide-react";
import { type LegalPageSlug, type FAQItem } from "@dvnt/app/lib/stores/legal-store";
import { useFAQStore } from "@dvnt/app/lib/stores/faq-store";
import { LEGAL_CONTENT } from "@dvnt/app/lib/constants/legal-content";

interface LegalPageProps {
  slug: LegalPageSlug;
  title: string;
}

type Section = {
  type: "heading" | "subheading" | "paragraph" | "list";
  content: string;
  items?: string[];
};

// Verbatim port of the native markdown parser.
function parseMarkdownContent(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split("\n");
  let currentParagraph = "";
  let currentList: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.trim()) {
      sections.push({ type: "paragraph", content: currentParagraph.trim() });
      currentParagraph = "";
    }
  };
  const flushList = () => {
    if (currentList.length > 0) {
      sections.push({ type: "list", content: "", items: currentList });
      currentList = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      sections.push({ type: "heading", content: trimmed.slice(3) });
    } else if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      sections.push({ type: "subheading", content: trimmed.slice(4) });
    } else if (trimmed.startsWith("• ") || trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      flushParagraph();
      currentList.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushParagraph();
      flushList();
    } else {
      if (currentList.length > 0) flushList();
      currentParagraph += (currentParagraph ? " " : "") + trimmed;
    }
  }
  flushParagraph();
  flushList();
  return sections;
}

function FAQSection({ faqs }: { faqs: FAQItem[] }) {
  const expandedIndex = useFAQStore((s) => s.expandedIndex);
  const toggleExpanded = useFAQStore((s) => s.toggleExpanded);
  const categories = [...new Set(faqs.map((f) => f.category || "General"))];

  return (
    <div>
      {categories.map((category) => (
        <div key={category} className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-cyan-400">{category}</h3>
          {faqs
            .filter((f) => (f.category || "General") === category)
            .map((faq, index) => {
              const globalIndex = faqs.indexOf(faq);
              const open = expandedIndex === globalIndex;
              return (
                <div key={index} className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-white/4">
                  <button
                    onClick={() => toggleExpanded(globalIndex)}
                    className="w-full flex items-center justify-between gap-2 p-4 text-left active:bg-white/5"
                  >
                    <span className="flex-1 pr-2 font-medium text-white">{faq.question}</span>
                    <ChevronDown
                      size={18}
                      className="text-white/40 shrink-0 transition-transform"
                      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                  </button>
                  {open ? (
                    <div className="border-t border-white/10 bg-white/4 p-4">
                      <p className="leading-6 text-white/90">{faq.answer}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/**
 * Legal / static content page — web (Phase 1 port of `components/legal-page.tsx`).
 * Renders bundled `LEGAL_CONTENT[slug]` (no async) parsed from markdown; FAQ
 * accordion via `useFAQStore`. One component powers about / terms /
 * privacy-policy / community-guidelines / ad-policy / eligibility / faq.
 */
export function LegalPage({ slug, title }: LegalPageProps) {
  const router = useRouter();
  const page = useMemo(() => LEGAL_CONTENT[slug as keyof typeof LEGAL_CONTENT] || null, [slug]);
  const sections = useMemo(() => (page?.content ? parseMarkdownContent(page.content) : []), [page?.content]);

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">{page?.title || title}</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        {!page ? (
          <p className="text-center text-white/50 py-16">Content not available for this page.</p>
        ) : (
          <>
            {page?.lastUpdated ? (
              <p className="mb-2 text-xs text-white/50">Last updated: {page.lastUpdated}</p>
            ) : null}
            {page?.subtitle ? <p className="mb-4 text-base text-cyan-400">{page.subtitle}</p> : null}

            {sections.length === 0 ? (
              <div className="mb-4 rounded-xl border border-white/10 bg-white/4 p-4">
                <p className="text-center text-white/50">No content available.</p>
              </div>
            ) : null}

            {sections.map((section, index) => {
              switch (section.type) {
                case "heading":
                  return (
                    <h2 key={index} className="mb-2 mt-6 text-lg font-semibold text-white">
                      {section.content}
                    </h2>
                  );
                case "subheading":
                  return (
                    <h3 key={index} className="mb-2 mt-4 font-semibold text-white">
                      {section.content}
                    </h3>
                  );
                case "list":
                  return (
                    <ul key={index} className="mb-4 ml-2">
                      {section.items?.map((item, i) => (
                        <li key={i} className="mb-1 flex gap-2">
                          <span className="text-cyan-400">•</span>
                          <span className="flex-1 leading-6 text-white/90">{item}</span>
                        </li>
                      ))}
                    </ul>
                  );
                case "paragraph":
                default: {
                  const isBold = section.content.startsWith("**") && section.content.endsWith("**");
                  const clean = isBold ? section.content.slice(2, -2) : section.content;
                  return (
                    <p key={index} className={`mb-4 leading-6 text-white/90 ${isBold ? "font-semibold" : ""}`}>
                      {clean}
                    </p>
                  );
                }
              }
            })}

            {"faqs" in page && Array.isArray((page as any).faqs) && (page as any).faqs.length > 0 ? (
              <div className="mt-6">
                <FAQSection faqs={(page as any).faqs} />
              </div>
            ) : null}

            <div className="mt-8 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <p className="mb-2 font-semibold text-white">Need Help?</p>
              <p className="text-sm text-white/50">Contact our support team at DeviantEventsDC@gmail.com</p>
            </div>
            <div className="h-8" />
          </>
        )}
      </main>
    </div>
  );
}
