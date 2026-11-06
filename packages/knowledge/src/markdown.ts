// A small Markdown reader for Learn articles. It builds a tree of plain data and never produces HTML: the
// screen draws the tree with Vue's escaping templates, so markup typed in an article is shown as text.
// Supported: headings, paragraphs, bullet and numbered lists, blockquotes, tables, bold, italic, code, links and
// citation marks such as [B40] or [A3, A4].

export type Inline =
  | { t: "text"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; children: Inline[] }
  | { t: "cite"; ids: string[] };

export type Block =
  | { t: "heading"; level: 2 | 3 | 4; children: Inline[] }
  | { t: "p"; children: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "quote"; blocks: Block[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][]; align: ("left" | "right" | "center" | null)[] };

const CITE = /^\[([A-D]\d+[a-z]?(?:\s*,\s*[A-D]\d+[a-z]?)*)\]/;

/** Only web, mail and in-app addresses become links; anything else (javascript:, data:) is shown as plain text.
 *  An in-app address may not start "//" or "/\": browsers read a backslash as a slash, so both lead to another host. They
 *  also drop tabs and line breaks inside an address ("/<tab>/host" is "//host"), so an address with one is refused. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/[\t\n\r]/.test(h)) return null;
  return /^(https?:\/\/|mailto:|\/(?![\/\\])|#)/i.test(h) ? h : null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", text: buf }); buf = ""; } };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!|<>]/.test(src[i + 1]!)) { buf += src[i + 1]; i += 2; continue; }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) { flush(); out.push({ t: "code", text: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (c === "[") {
      const cite = CITE.exec(src.slice(i));
      if (cite) { flush(); out.push({ t: "cite", ids: cite[1]!.split(",").map((s) => s.trim()) }); i += cite[0].length; continue; }
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]!);
        const children = parseInline(m[1]!);
        if (href) out.push({ t: "link", href, children }); else out.push(...children);
        i += m[0].length; continue;
      }
    }
    if (c === "*" || c === "_") {
      const double = src[i + 1] === c;
      const mark = double ? c + c : c;
      const start = i + mark.length;
      // `_` inside a word (snake_case) is not emphasis; an opener must be followed by a non-space
      const prev = i > 0 ? src[i - 1]! : " ";
      if (src[start] && !/\s/.test(src[start]!) && !(c === "_" && /\w/.test(prev))) {
        let end = src.indexOf(mark, start);
        while (end > 0 && (/\s/.test(src[end - 1]!) || (c === "_" && /\w/.test(src[end + mark.length] ?? " ")))) end = src.indexOf(mark, end + 1);
        if (end > start) {
          flush();
          out.push({ t: double ? "strong" : "em", children: parseInline(src.slice(start, end)) });
          i = end + mark.length; continue;
        }
      }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      // article titles come from the front matter, so a body "#" is shown as a section heading
      const level = Math.min(4, Math.max(2, h[1]!.length)) as 2 | 3 | 4;
      blocks.push({ t: "heading", level, children: parseInline(h[2]!) }); i++; continue;
    }
    if (/^>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^>/.test(lines[i]!)) inner.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push({ t: "quote", blocks: parseMarkdown(inner.join("\n")) }); continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : null) as "left" | "right" | "center" | null);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(cells(lines[i++]!).map(parseInline));
      blocks.push({ t: "table", head: head.map(parseInline), rows, align }); continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line), ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol, items: string[] = [];
      const start = ol ? Number(ol[1]) : 1;
      const marker = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length) {
        const m = marker.exec(lines[i]!);
        if (m) { items.push(m[1]!); i++; }
        // a wrapped line continues the item; a blank line or a different block ends the list
        else if (lines[i]!.trim() && /^\s+\S/.test(lines[i]!) && items.length) { items[items.length - 1] += " " + lines[i++]!.trim(); }
        else break;
      }
      blocks.push(ordered ? { t: "ol", items: items.map(parseInline), start } : { t: "ul", items: items.map(parseInline) }); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]!) && !(lines[i]!.includes("|") && isTableSep(lines[i + 1] ?? ""))) para.push(lines[i++]!.trim());
    if (!para.length) { para.push(line.trim()); i++; }
    blocks.push({ t: "p", children: parseInline(para.join(" ")) });
  }
  return blocks;
}

/** Plain text of inline nodes (for search snippets, glossary terms). Citations drop out. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.text : n.t === "cite" ? "" : inlineText(n.children))).join("");
}
