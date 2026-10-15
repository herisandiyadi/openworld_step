import { describe, expect, it } from 'vitest';
import { parseOsmXml } from './osm';
import { propKindFor } from './convert';
import { buildLanesFromOsm } from './lanes';

/**
 * Regresi: OSM menaruh pohon/lampu/bangku sebagai NODE bertag, bukan way. Parser lama hanya
 * menyimpan koordinat node tanpa tag, sehingga props selalu kosong dan dunia hanya berisi
 * bangunan + aspal (keluhan nyata: "hanya gedung dan putih saja").
 */
const xml = `<?xml version="1.0"?>
<osm version="0.6">
  <node id="1" lat="-6.2445" lon="106.8000"><tag k="natural" v="tree"/></node>
  <node id="2" lat="-6.2446" lon="106.8001"><tag k="highway" v="street_lamp"/></node>
  <node id="3" lat="-6.2447" lon="106.8002"><tag k="amenity" v="bench"/></node>
  <node id="4" lat="-6.2448" lon="106.8003"><tag k="amenity" v="waste_basket"/></node>
  <node id="5" lat="-6.2449" lon="106.8004"/>
  <way id="10">
    <nd ref="5"/><nd ref="6"/>
    <tag k="highway" v="residential"/>
  </way>
  <node id="6" lat="-6.2450" lon="106.8005"/>
</osm>`;

describe('parseOsmXml', () => {
  it('membaca tag pada node (bukan hanya way)', () => {
    const data = parseOsmXml(xml);
    expect(data.nodes.get('1')?.tags.natural).toBe('tree');
    expect(data.nodes.get('2')?.tags.highway).toBe('street_lamp');
    expect(data.nodes.get('5')?.tags).toEqual({});
  });
});

describe('propKindFor', () => {
  it('pohon -> prop_tree_01', () => {
    expect(propKindFor({ natural: 'tree' })).toBe('prop_tree_01');
  });

  it('lampu jalan -> prop_streetlamp_01', () => {
    expect(propKindFor({ highway: 'street_lamp' })).toBe('prop_streetlamp_01');
  });

  it('bangku -> prop_bench_01', () => {
    expect(propKindFor({ amenity: 'bench' })).toBe('prop_bench_01');
  });

  it('tempat sampah -> prop_trashbin_01', () => {
    expect(propKindFor({ amenity: 'waste_basket' })).toBe('prop_trashbin_01');
  });

  it('tag tak dikenal -> null (tidak ada asset)', () => {
    expect(propKindFor({ amenity: 'atm' })).toBeNull();
    expect(propKindFor({})).toBeNull();
  });
});

describe('buildLanesFromOsm', () => {
  const toX = (lon: number) => (lon - 106.8) * 111_320;
  const toZ = (lat: number) => (lat - (-6.245)) * -111_320;

  it('membangun walkEdges dari way walkable (pedestrian bisa jalan)', () => {
    const lanes = buildLanesFromOsm(parseOsmXml(xml), toX, toZ, 500);
    // way residential menghasilkan edge trotoar + edge kendaraan
    expect(lanes.walkEdges.length).toBeGreaterThan(0);
    expect(lanes.edges.length).toBeGreaterThan(0);
    expect(lanes.walkNodes.length).toBeGreaterThan(0);
    expect(lanes.version).toBe(3);
  });

  it('mengabaikan way non-jalan (building) untuk lanes', () => {
    const buildingXml = `<osm>
      <node id="1" lat="-6.2445" lon="106.8000"/><node id="2" lat="-6.2446" lon="106.8001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="building" v="yes"/></way>
    </osm>`;
    const lanes = buildLanesFromOsm(parseOsmXml(buildingXml), toX, toZ, 500);
    expect(lanes.walkEdges).toHaveLength(0);
    expect(lanes.edges).toHaveLength(0);
  });

  it('menyaring node di luar batas dunia', () => {
    const lanes = buildLanesFromOsm(parseOsmXml(xml), toX, toZ, 0.5);
    expect(lanes.walkNodes.length).toBe(0);
  });
});
