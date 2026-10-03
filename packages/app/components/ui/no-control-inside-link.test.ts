/**
 * No interactive control may sit inside a link on web.
 *
 * Tapping Like on a home-grid tile started the top progress bar. The tile was a
 * `<CardLink>` (an `<a href>`) and the Like and Bookmark buttons were inside it.
 * nextjs-toploader listens for clicks on `document`, starts whenever the click
 * target has an `<a href>` ancestor, and never checks `defaultPrevented`. Next's
 * App Router hydrates React into `document` too, so React's root listener and
 * the toploader's share a node and the buttons' `stopPropagation()` cannot hold
 * it back. A `<button>` inside an `<a>` is also invalid interactive content: one
 * focusable thing inside another, announced twice.
 *
 * The fix is structural: a control is a sibling of the link, never a
 * descendant. This test parses every web TSX file and fails on any control
 * found inside a link element in the same JSX tree.
 *
 * Components declared in the same file are followed: a `<CategoryPill>` that
 * renders a `<Link>` counts as a link where it is used. Imported components are
 * not followed into their own files; tag names ending in `Button` are treated
 * as controls to cover the common case.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "../../../..");

/** Modules whose default or named `Link` export renders an `<a href>`. */
const LINK_MODULES: Record<string, string[]> = {
  "next/link": ["default"],
  "solito/link": ["Link", "TextLink"],
  "@dvnt/app/components/ui/card-link.web": ["CardLink"],
};

const CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "a"]);
const CONTROL_HANDLERS = new Set(["onClick", "onPress", "onPointerDown", "onMouseDown"]);

export type Violation = { file: string; line: number; control: string; link: string };

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

function attrNames(node: ts.JsxOpeningLikeElement): Set<string> {
  const out = new Set<string>();
  for (const p of node.attributes.properties) {
    if (ts.isJsxAttribute(p)) out.add(p.name.getText());
  }
  return out;
}

function attrString(node: ts.JsxOpeningLikeElement, name: string): string | null {
  for (const p of node.attributes.properties) {
    if (ts.isJsxAttribute(p) && p.name.getText() === name && p.initializer) {
      if (ts.isStringLiteral(p.initializer)) return p.initializer.text;
    }
  }
  return null;
}

function linkLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const wanted = LINK_MODULES[st.moduleSpecifier.text];
    const clause = st.importClause;
    if (!wanted || !clause) continue;
    if (clause.name && wanted.includes("default")) names.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (wanted.includes(imported)) names.add(el.name.text);
      }
    }
  }
  return names;
}

function isLink(node: ts.JsxOpeningLikeElement, linkNames: Set<string>): boolean {
  const name = tagName(node);
  if (name === "a") return attrNames(node).has("href");
  return linkNames.has(name);
}

function isControl(node: ts.JsxOpeningLikeElement, linkNames: Set<string>): boolean {
  const name = tagName(node);
  if (CONTROL_TAGS.has(name)) return true;
  if (linkNames.has(name)) return true; // a link inside a link
  if (/Button$/.test(name) || name === "Pressable") return true;
  if (attrString(node, "role") === "button") return true;
  for (const a of attrNames(node)) if (CONTROL_HANDLERS.has(a)) return true;
  return false;
}

/** Name -> body of every component declared at the top level of the file. */
function localComponents(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && /^[A-Z]/.test(st.name.text)) {
      out.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && /^[A-Z]/.test(d.name.text) && d.initializer) {
          out.set(d.name.text, d.initializer);
        }
      }
    }
  }
  return out;
}

function containsJsx(node: ts.Node, pred: (o: ts.JsxOpeningLikeElement) => boolean): boolean {
  let hit = false;
  const v = (n: ts.Node) => {
    if (hit) return;
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && pred(n)) {
      hit = true;
      return;
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return hit;
}

export function findControlsInsideLinks(source: string, file = "inline.tsx"): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const linkNames = linkLocalNames(sf);
  // A same-file component whose output is (or contains) a link becomes a link
  // name too, so `NavLink`-style wrappers and `<CategoryPill>` chips that
  // render `<Link>` are seen where they are used. Iterate to a fixed point so
  // a wrapper of a wrapper resolves.
  const components = localComponents(sf);
  const controlComponents = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of components) {
      if (linkNames.has(name)) continue;
      if (containsJsx(body, (o) => isLink(o, linkNames))) {
        linkNames.add(name);
        changed = true;
      }
    }
  }
  for (const [name, body] of components) {
    if (linkNames.has(name)) continue;
    if (containsJsx(body, (o) => isControl(o, linkNames))) controlComponents.add(name);
  }
  const isControlHere = (o: ts.JsxOpeningLikeElement) =>
    isControl(o, linkNames) || controlComponents.has(tagName(o));
  const out: Violation[] = [];

  const visit = (node: ts.Node, enclosingLink: string | null) => {
    let opening: ts.JsxOpeningLikeElement | null = null;
    if (ts.isJsxElement(node)) opening = node.openingElement;
    else if (ts.isJsxSelfClosingElement(node)) opening = node;

    let nextLink = enclosingLink;
    if (opening) {
      if (enclosingLink && isControlHere(opening)) {
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(opening.getStart()).line + 1,
          control: tagName(opening),
          link: enclosingLink,
        });
      }
      if (isLink(opening, linkNames)) nextLink = tagName(opening);
    }
    // Attributes of the link itself are not its descendants.
    if (ts.isJsxElement(node)) {
      for (const child of node.children) visit(child, nextLink);
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) return;
    // Leaving JSX (e.g. a callback defined in an attribute) keeps the context:
    // `{items.map(i => <button/>)}` inside a link is still inside it.
    ts.forEachChild(node, (c) => visit(c, enclosingLink));
  };
  visit(sf, null);
  return out;
}

function walk(dir: string, match: (p: string) => boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, match, acc);
    else if (match(p)) acc.push(p);
  }
  return acc;
}

function webFiles(): string[] {
  return [
    ...walk(join(ROOT, "packages/app"), (p) => p.endsWith(".web.tsx")),
    ...walk(join(ROOT, "packages/ui"), (p) => p.endsWith(".web.tsx")),
    ...walk(join(ROOT, "apps/web/src"), (p) => p.endsWith(".tsx")),
  ];
}

test("detector: flags a button inside a CardLink, passes a sibling", () => {
  const imp = `import { CardLink } from "@dvnt/app/components/ui/card-link.web";\n`;
  const nested = `${imp}const A = () => <CardLink href="/x"><img /><div><button onClick={f}>Like</button></div></CardLink>;`;
  const sibling = `${imp}const A = () => <div><CardLink href="/x"><img /></CardLink><div><button onClick={f}>Like</button></div></div>;`;
  assert.equal(findControlsInsideLinks(nested).length, 1);
  assert.deepEqual(findControlsInsideLinks(sibling), []);
});

test("detector: flags controls under next/link and raw <a href>, follows .map callbacks", () => {
  const src = `import NextLink from "next/link";
const A = () => <>
  <NextLink href="/a">{xs.map(x => <button key={x}/>)}</NextLink>
  <a href="/b"><span role="button" /></a>
  <a><button /></a>
</>;`;
  const v = findControlsInsideLinks(src);
  assert.deepEqual(v.map((x) => [x.control, x.link]), [["button", "NextLink"], ["span", "a"]]);
});

test("detector: follows same-file components that render a link or a button", () => {
  const src = `import Link from "next/link";
function Pill() { return <Link href="/c">c</Link>; }
function Like() { return <button onClick={f}>like</button>; }
const Card = () => <Link href="/p"><Pill /><h2>t</h2><Like /></Link>;`;
  assert.deepEqual(findControlsInsideLinks(src).map((x) => x.control), ["Pill", "Like"]);
});

test("home grid tile: Like and Bookmark are not descendants of the post link", () => {
  const file = join(ROOT, "packages/app/features/home/screen.web.tsx");
  const v = findControlsInsideLinks(readFileSync(file, "utf8"), relative(ROOT, file));
  assert.deepEqual(v, [], `controls inside a link:\n${v.map((x) => `${x.file}:${x.line} <${x.control}> in <${x.link}>`).join("\n")}`);
});

test("no web file nests a control inside a link", () => {
  const all = webFiles().flatMap((f) =>
    findControlsInsideLinks(readFileSync(f, "utf8"), relative(ROOT, f)),
  );
  assert.deepEqual(
    all.map((x) => `${x.file}:${x.line} <${x.control}> in <${x.link}>`),
    [],
  );
});
