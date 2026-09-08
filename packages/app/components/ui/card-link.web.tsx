"use client";
/**
 * Interactive card surfaces for the web app.
 *
 * Six places rendered a card as `<div role="button">` — some with `tabIndex`
 * and no key handler at all, so they took focus, announced themselves as
 * buttons, and could not be activated from a keyboard (WCAG 2.1.1). Others had
 * neither, so they were unreachable entirely.
 *
 * The split is the point: something that goes somewhere is a link, and
 * something that does something is a button. A link gets middle-click,
 * cmd-click, "copy link address", and the screen-reader link rotor for free —
 * all of which a div throws away.
 */

import { useCallback } from "react";
import { useRouter } from "solito/navigation";

/** Modified clicks belong to the browser: new tab, new window, download. */
function isPlainLeftClick(e: React.MouseEvent): boolean {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.defaultPrevented
  );
}

export function CardLink({
  href,
  children,
  className,
  style,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const router = useRouter();

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // A real href stays in the markup so the browser keeps its behaviours;
      // a plain click is intercepted for client-side navigation.
      if (!isPlainLeftClick(e)) return;
      e.preventDefault();
      router.push(href);
    },
    [href, router],
  );

  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={ariaLabel}
      className={className}
      style={{ textDecoration: "none", color: "inherit", ...style }}
    >
      {children}
    </a>
  );
}

/**
 * A full-bleed dismiss target behind an overlay's content.
 *
 * The scanner's result overlays were `<div role="button">` wrapping the whole
 * result, which announced the entire panel — icon, heading, check-in facts — as
 * one button. The panel stays a plain region (it carries `aria-live`, which is
 * how a door scanner announces a result at all); this sits behind it as the
 * dismiss control, focusable and labelled.
 */
export function DismissOverlayButton({
  onPress,
  label = "Dismiss",
}: {
  onPress: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0"
    />
  );
}
