import type { ReactNode } from 'react';

/**
 * A tiny markdown renderer for client profiles (headings, bullet lists,
 * paragraphs, **bold**, *italic*, `code`). Builds React elements, never HTML
 * strings, so profile text cannot inject markup.
 */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length) {
      const k = `l${blocks.length}`;
      blocks.push(
        <ul key={k}>
          {list.map((li, i) => (
            <li key={i} className={li === '(none yet)' ? 'md-empty' : undefined}>
              {inline(li, `${k}-${i}`)}
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>);
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1]!.length;
      const k = `h${blocks.length}`;
      const content = inline(h[2]!, k);
      blocks.push(level === 1 ? <h2 key={k} className="md-h1">{content}</h2> : level === 2 ? <h3 key={k} className="md-h2">{content}</h3> : <h4 key={k} className="md-h3">{content}</h4>);
    } else if (li) {
      if (para.length) flush();
      list.push(li[1]!);
    } else if (!line.trim()) {
      flush();
    } else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="md">{blocks}</div>;
}
