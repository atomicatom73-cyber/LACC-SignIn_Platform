import type { InlineNode } from "@/lib/richtext";
import { parseRichText } from "@/lib/richtext";

/**
 * Render a job description's markup (see lib/richtext.ts). Deliberately not a
 * client component so the officer board, the printable sheet, and the member's
 * card can all use it — React escapes the text for us, and no HTML from the
 * stored string is ever trusted.
 */
export function RichText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const blocks = parseRichText(value);
  if (blocks.length === 0) return null;

  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.type === "list" ? (
          // Marker and indent are inline, not utility classes: Tailwind's
          // preflight zeroes `list-style` on every ul, and this component also
          // renders into the printable sheet — an inline style is the one thing
          // that reliably survives both.
          <ul
            key={i}
            className="space-y-0.5"
            style={{ listStyleType: "disc", paddingLeft: "1.25rem" }}
          >
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{renderInline(block.children)}</p>
        ),
      )}
    </div>
  );
}

function renderInline(nodes: InlineNode[]) {
  return nodes.map((node, i) => {
    if (node.type === "text") return node.value;
    const inner = renderInline(node.children);
    if (node.type === "bold") return <strong key={i}>{inner}</strong>;
    if (node.type === "italic") return <em key={i}>{inner}</em>;
    return <u key={i}>{inner}</u>;
  });
}
