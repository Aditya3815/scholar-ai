import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { mdPlain } from "@scholar/shared";
import { MdView, QuoteBlockView } from "./NbBlocks";
import { inkPlainOf } from "../../../../lib/note-ink";

/** What an ink anchor counts in (docs/design/paper-reader.md, 25.5) is exactly the text the page puts into the DOM: mdPlain(md) === element.textContent, for every kind of Markdown. */
const textContent = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("an anchor's text is the DOM's text", () => {
  const cases = [
    "plain words",
    "# Heading one\n## Two\n### Three",
    "Some **bold**, *italic*, ++under++, <u>old</u> and ==marked== words\nwith a line break",
    "- one\n- **two**\n\n1. first\n2. second",
    "a \*star\* & <tag> \"quotes\" 'single'",
    "मूल्यांकन **हिंदी** text",
    "",
  ];
  for (const md of cases)
    it(JSON.stringify(md.slice(0, 30)), () => {
      expect(textContent(renderToStaticMarkup(createElement(MdView, { md })))).toBe(mdPlain(md));
    });
  it("a quote's words, in their marks", () => {
    const b = { id: "q", kind: "quote" as const, noteId: null, page: 2, quote: "a passage & more", color: "pink" as const };
    const html = renderToStaticMarkup(createElement(QuoteBlockView, { b, mean: { name: "Result", letter: "R" } as never, removed: false, onGo: () => {} }));
    const quote = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(html)![1]!;
    expect(textContent(quote)).toBe(inkPlainOf(b));
  });
});
