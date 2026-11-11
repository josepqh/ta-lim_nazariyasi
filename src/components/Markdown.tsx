import { Fragment, type ReactNode } from 'react';

// A small Markdown reader for teacher and article texts: **bold**, *italic*, `code`, [links](https://…),
// ## headings, - lists, 1. lists and > quotes. It builds React elements only, never HTML,
// so a text can never run code on the page; links are limited to http(s) and mailto.
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[2] !== undefined) nodes.push(<strong key={key}>{inline(match[2], key)}</strong>);
    else if (match[3] !== undefined) nodes.push(<em key={key}>{inline(match[3], key)}</em>);
    else if (match[4] !== undefined) nodes.push(<code key={key}>{match[4]}</code>);
    else if (match[5] !== undefined && match[6] !== undefined) {
      nodes.push(SAFE_LINK.test(match[6])
        ? <a key={key} href={match[6]} target="_blank" rel="noopener noreferrer nofollow">{match[5]}</a>
        : match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function lines(text: string, key: string): ReactNode[] {
  return text.split('\n').flatMap((line, i, all) => {
    const parts = inline(line, `${key}-${i}`);
    return i < all.length - 1 ? [...parts, <br key={`${key}-br-${i}`}/>] : parts;
  });
}

export function Markdown({ text, className = 'prose-text' }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    const key = `b${i}`;
    if (!row.trim()) { i += 1; continue; }
    const heading = row.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      blocks.push(heading[1] === '##' ? <h3 key={key}>{inline(heading[2]!, key)}</h3> : <h4 key={key}>{inline(heading[2]!, key)}</h4>);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(row)) {
      const items: string[] = [];
      while (i < rows.length && /^\s*[-*]\s+/.test(rows[i]!)) items.push(rows[i++]!.replace(/^\s*[-*]\s+/, ''));
      blocks.push(<ul key={key}>{items.map((item, n) => <li key={n}>{inline(item, `${key}-${n}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(row)) {
      const items: string[] = [];
      while (i < rows.length && /^\s*\d+[.)]\s+/.test(rows[i]!)) items.push(rows[i++]!.replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push(<ol key={key}>{items.map((item, n) => <li key={n}>{inline(item, `${key}-${n}`)}</li>)}</ol>);
      continue;
    }
    if (/^>\s?/.test(row)) {
      const quoted: string[] = [];
      while (i < rows.length && /^>\s?/.test(rows[i]!)) quoted.push(rows[i++]!.replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key}>{lines(quoted.join('\n'), key)}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (i < rows.length && rows[i]!.trim() && !/^(#{2,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>)/.test(rows[i]!)) paragraph.push(rows[i++]!);
    blocks.push(<p key={key}>{lines(paragraph.join('\n'), key)}</p>);
  }
  return <div className={className}>{blocks.map((block, n) => <Fragment key={n}>{block}</Fragment>)}</div>;
}

// Plain text for previews (cards, meta descriptions).
export function plainText(text: string): string {
  return text.replace(/\*\*|`|^#{2,3}\s|^>\s?|^\s*[-*]\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
}
