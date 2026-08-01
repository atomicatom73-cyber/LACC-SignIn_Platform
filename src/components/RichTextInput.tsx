"use client";

import { useEffect, useRef, useState } from "react";
import { hasMarkup } from "@/lib/richtext";
import { RichText } from "./RichText";

type Tool = { label: string; title: string; delim?: string; bullet?: boolean };

const TOOLS: Tool[] = [
  { label: "B", title: "Bold (Ctrl+B)", delim: "**" },
  { label: "U", title: "Underline (Ctrl+U)", delim: "__" },
  { label: "I", title: "Italic (Ctrl+I)", delim: "*" },
  { label: "•", title: "Bullet list", bullet: true },
];

/**
 * Textarea with a B / U / I / • toolbar for job descriptions. The field stays
 * uncontrolled so the surrounding <form action={…}> and its reset() keep
 * working untouched; `preview` mirrors it purely to show the officer what the
 * markers will look like on a member's phone.
 *
 * The box grows to fit whatever is in it: a long description written months ago
 * is fully readable the moment you open the editor, instead of hiding most of
 * itself behind a three-line scroll. `rows` is the floor, not the height.
 */
export function RichTextInput({
  name,
  defaultValue = "",
  placeholder,
  rows = 3,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(defaultValue);

  /**
   * Match the height to the content. Collapsing to "auto" first is what lets
   * the box shrink again after text is deleted — scrollHeight never reports
   * less than the current height.
   */
  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // The box is border-box but scrollHeight isn't — without adding the border
    // back, every field keeps a 2px scroll it can never satisfy.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  };

  // Fit the existing description on open (the edit form only mounts when the
  // officer taps Edit, so this runs with real layout available), and again
  // whenever a different job's text is passed in.
  useEffect(autoGrow, [defaultValue]);

  // A successful add calls form.reset(), which restores the textarea's
  // defaultValue without telling React — follow it so the preview doesn't keep
  // showing the job that was just saved. Resize on the next frame: at event
  // time the field still holds the old text.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => {
      setPreview(defaultValue);
      requestAnimationFrame(autoGrow);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue]);

  /** Rewrite the field, keep the caret sane, and re-run the preview. */
  const apply = (value: string, start: number, end: number) => {
    const el = ref.current;
    if (!el) return;
    el.value = value;
    el.focus();
    el.setSelectionRange(start, end);
    setPreview(value);
    autoGrow(); // bulleting a block can add a line to every row
  };

  const wrap = (delim: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to, value } = el;
    const selected = value.slice(from, to);
    const next =
      value.slice(0, from) + delim + selected + delim + value.slice(to);
    // With nothing selected, drop the caret between the markers so the officer
    // can just keep typing; otherwise leave the wrapped words selected.
    apply(
      next,
      selected ? from : from + delim.length,
      selected ? to + delim.length * 2 : from + delim.length,
    );
  };

  const bullet = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to, value } = el;
    // Grow the selection to whole lines, so bulleting mid-word still works.
    const lineStart = value.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = value.indexOf("\n", to) === -1 ? value.length : value.indexOf("\n", to);
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const bulleted = lines.every((l) => /^\s*[-•]\s+/.test(l));
    const next = lines
      .map((l) => (bulleted ? l.replace(/^\s*[-•]\s+/, "") : `- ${l}`))
      .join("\n");
    apply(
      value.slice(0, lineStart) + next + value.slice(lineEnd),
      lineStart,
      lineStart + next.length,
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const key = e.key.toLowerCase();
    const delim = key === "b" ? "**" : key === "u" ? "__" : key === "i" ? "*" : null;
    if (!delim) return;
    e.preventDefault(); // Ctrl+U is "view source" in some browsers.
    wrap(delim);
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            onClick={() => (tool.bullet ? bullet() : wrap(tool.delim!))}
            className={`h-8 w-8 rounded-lg border border-border bg-surface-2 text-sm text-muted transition active:scale-[0.95] ${
              tool.label === "B"
                ? "font-bold"
                : tool.label === "U"
                  ? "underline"
                  : tool.label === "I"
                    ? "italic"
                    : ""
            }`}
          >
            {tool.label}
          </button>
        ))}
        <span className="text-[11px] text-muted">
          Select words, then tap a button
        </span>
      </div>
      <textarea
        ref={ref}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setPreview(e.target.value);
          autoGrow();
        }}
        // Never smaller than `rows` lines: text-sm leading (1.25rem) per row,
        // plus py-2.5 top and bottom, plus the border.
        style={{ minHeight: `calc(${rows} * 1.25rem + 1.25rem + 2px)` }}
        className="mt-1.5 w-full resize-none overflow-hidden rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      {preview.trim() && hasMarkup(preview) && (
        <div className="mt-1.5 rounded-xl border border-dashed border-border px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted">
            Members will see
          </div>
          <RichText
            value={preview}
            className="mt-1 space-y-1 text-sm font-medium text-foreground"
          />
        </div>
      )}
    </div>
  );
}
