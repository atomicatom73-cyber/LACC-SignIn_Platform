/**
 * The tiny markup used in job descriptions.
 *
 * Officers type into a plain textarea with a B / U / I / • toolbar that wraps
 * the selection in markers, so what's stored stays readable text — a job
 * description written before this existed renders unchanged, and one written
 * with it still makes sense in a plain-text email:
 *
 *   **bold**   __underline__   *italic*   "- " at the start of a line = bullet
 *
 * Everything here is deliberately small. It is NOT markdown: no links, no
 * headings, no HTML passthrough. The parser produces a tree that both the React
 * renderer (components/RichText.tsx) and the email renderer below walk, so the
 * phone card, the officer board, the printable sheet, and the reminder email
 * can never drift apart.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] };

export type Block =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; items: InlineNode[][] };

/** Longest delimiters first, so `**` never gets eaten by the italic rule. */
const MARKS = [
  { delim: "**", type: "bold" },
  { delim: "__", type: "underline" },
  { delim: "*", type: "italic" },
  { delim: "_", type: "italic" },
] as const;

const BULLET = /^\s*[-•]\s+/;

/**
 * Split one line into styled runs. Unmatched or empty markers ("2 * 3", "**")
 * fall through as literal text — a stray asterisk in a job description should
 * look like a stray asterisk, not silently swallow the rest of the sentence.
 */
function parseInline(src: string): InlineNode[] {
  for (const { delim, type } of MARKS) {
    const start = src.indexOf(delim);
    if (start === -1) continue;
    const end = src.indexOf(delim, start + delim.length);
    if (end === -1) continue;

    const inner = src.slice(start + delim.length, end);
    // Empty ("****") or space-hugging ("a * b * c") — not emphasis.
    if (!inner.trim() || /^\s|\s$/.test(inner)) continue;

    const before = src.slice(0, start);
    const after = src.slice(end + delim.length);
    return [
      ...parseInline(before),
      { type, children: parseInline(inner) },
      ...parseInline(after),
    ];
  }
  return src ? [{ type: "text", value: src }] : [];
}

/**
 * Parse a stored description into blocks. Each line is its own paragraph (the
 * textarea's line breaks are what the officer typed, so they're kept as-is) and
 * runs of "- " lines collapse into a single bulleted list.
 */
export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let list: InlineNode[][] | null = null;

  for (const line of source.split(/\r?\n/)) {
    if (BULLET.test(line)) {
      const item = parseInline(line.replace(BULLET, ""));
      if (list) {
        list.push(item);
      } else {
        list = [item];
        blocks.push({ type: "list", items: list });
      }
      continue;
    }
    list = null;
    // A blank line is a breather between paragraphs, not a paragraph.
    if (!line.trim()) continue;
    blocks.push({ type: "paragraph", children: parseInline(line) });
  }

  return blocks;
}

/** Does this text use any markup at all? Lets callers skip the parser. */
export function hasMarkup(source: string): boolean {
  return /\*\*|__|\*|_/.test(source) || source.split(/\r?\n/).some((l) => BULLET.test(l));
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

function inlineToHtml(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return escapeHtml(node.value);
      const inner = inlineToHtml(node.children);
      if (node.type === "bold") return `<strong>${inner}</strong>`;
      if (node.type === "italic") return `<em>${inner}</em>`;
      return `<u>${inner}</u>`;
    })
    .join("");
}

/**
 * Render for an HTML email. Text is escaped here (the emails are assembled as
 * strings, not JSX), and the styles are inline because mail clients drop
 * stylesheets. `style` lets the caller match the surrounding email's type.
 */
export function richTextToHtml(
  source: string,
  style = "margin:0 0 6px;",
): string {
  return parseRichText(source)
    .map((block) => {
      if (block.type === "list") {
        const items = block.items
          .map((item) => `<li>${inlineToHtml(item)}</li>`)
          .join("");
        return `<ul style="${style}padding-left:20px;">${items}</ul>`;
      }
      return `<p style="${style}">${inlineToHtml(block.children)}</p>`;
    })
    .join("");
}

function inlineToPlain(nodes: InlineNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" ? node.value : inlineToPlain(node.children),
    )
    .join("");
}

/**
 * Strip the markers for plain-text email and anywhere a single unstyled line is
 * wanted (the sign-in log sheet, an aria-label). Bullets keep a "• " so a list
 * still reads like a list.
 */
export function richTextToPlain(source: string, joiner = "\n"): string {
  return parseRichText(source)
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => `• ${inlineToPlain(item)}`).join(joiner)
        : inlineToPlain(block.children),
    )
    .join(joiner);
}
