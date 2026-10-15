/**
 * Parser OSM XML minimal (tanpa dependency). Hanya membaca node, way, dan tag.
 * Output deterministik: urutan way sama dengan urutan di file.
 */
export interface OsmNode { lon: number; lat: number; tags: Record<string, string>; }
export interface OsmWay { id: string; nodes: string[]; tags: Record<string, string>; }
export interface OsmData { nodes: Map<string, OsmNode>; ways: OsmWay[]; }

const NODE_RE = /<node\b[^>]*?\bid="([^"]+)"[^>]*?\blat="([^"]+)"[^>]*?\blon="([^"]+)"[^>]*?(\/>|>)/g;
const NODE_RE_ALT = /<node\b[^>]*?\blon="([^"]+)"[^>]*?\blat="([^"]+)"[^>]*?\bid="([^"]+)"/g;
/** Blok <node ...>...</node> (self-closing tidak punya isi, jadi tidak ikut). */
const NODE_BLOCK_RE = /<node\b[^>]*?\bid="([^"]+)"[^>]*?(\/>|>)([\s\S]*?)<\/node>/g;
const WAY_RE = /<way\b[^>]*?\bid="([^"]+)"[^>]*>([\s\S]*?)<\/way>/g;
const ND_RE = /<nd\b[^>]*?\bref="([^"]+)"/g;
const TAG_RE = /<tag\b[^>]*?\bk="([^"]*)"[^>]*?\bv="([^"]*)"/g;

export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseOsmXml(xml: string): OsmData {
  const nodes = new Map<string, OsmNode>();
  let m: RegExpExecArray | null;
  NODE_RE.lastIndex = 0;
  while ((m = NODE_RE.exec(xml))) {
    nodes.set(m[1] as string, { lat: Number(m[2]), lon: Number(m[3]), tags: {} });
  }
  // Tangani urutan atribut yang berbeda (lon sebelum lat, atau id di belakang).
  NODE_RE_ALT.lastIndex = 0;
  while ((m = NODE_RE_ALT.exec(xml))) {
    if (!nodes.has(m[3] as string)) nodes.set(m[3] as string, { lon: Number(m[1]), lat: Number(m[2]), tags: {} });
  }
  // Tag pada node: pohon (natural=tree), lampu jalan (highway=street_lamp), bangku (amenity=bench).
  // Tanpa ini, prop OSM tidak pernah terbaca dan dunia hanya berisi bangunan kosong.
  NODE_BLOCK_RE.lastIndex = 0;
  while ((m = NODE_BLOCK_RE.exec(xml))) {
    const node = nodes.get(m[1] as string);
    if (!node || !m[3]) continue;
    const tags: Record<string, string> = {};
    let r: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;
    while ((r = TAG_RE.exec(m[3]))) tags[decodeEntities(r[1] as string)] = decodeEntities(r[2] as string);
    node.tags = tags;
  }
  const ways: OsmWay[] = [];
  WAY_RE.lastIndex = 0;
  while ((m = WAY_RE.exec(xml))) {
    const id = m[1] as string;
    const body = m[2] as string;
    const refs: string[] = [];
    let r: RegExpExecArray | null;
    ND_RE.lastIndex = 0;
    while ((r = ND_RE.exec(body))) refs.push(r[1] as string);
    const tags: Record<string, string> = {};
    TAG_RE.lastIndex = 0;
    while ((r = TAG_RE.exec(body))) tags[decodeEntities(r[1] as string)] = decodeEntities(r[2] as string);
    if (refs.length >= 2) ways.push({ id, nodes: refs, tags });
  }
  return { nodes, ways };
}
