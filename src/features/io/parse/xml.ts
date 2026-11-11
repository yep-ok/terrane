// Tiny tolerant XML reader (no DOM needed, so KML/GPX/WMS parsing is testable in node).
// Element names are stored without their namespace prefix.

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[e] ?? m;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}

const local = (q: string) => {
  const i = q.indexOf(':');
  return i >= 0 ? q.slice(i + 1) : q;
};

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([^\s>\/]+)([^>]*?)(\/?)>|([^<]+)/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse an XML document and return its root element. Throws if no element is found. */
export function parseXml(src: string): XNode {
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const root: XNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[3] !== undefined) {
      if (m[2]) {
        // closing tag
        if (stack.length > 1) stack.pop();
      } else {
        const attrs: Record<string, string> = {};
        if (m[4]) {
          ATTR.lastIndex = 0;
          let a: RegExpExecArray | null;
          while ((a = ATTR.exec(m[4]))) attrs[local(a[1])] = decodeEntities(a[2] ?? a[3] ?? '');
        }
        const node: XNode = { name: local(m[3]), attrs, children: [], text: '' };
        top.children.push(node);
        if (!m[5]) stack.push(node);
      }
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
    }
  }
  const el = root.children[0];
  if (!el) throw new Error('Not a valid XML document');
  return el;
}

export const kids = (n: XNode, name: string): XNode[] => n.children.filter((c) => c.name === name);
export const kid = (n: XNode, name: string): XNode | undefined => n.children.find((c) => c.name === name);
export const textOf = (n: XNode | undefined): string => (n ? n.text.trim() : '');
export const kidText = (n: XNode, name: string): string => textOf(kid(n, name));

/** All descendants with a given element name (depth first). */
export function descendants(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
