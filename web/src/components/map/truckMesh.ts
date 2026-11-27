/** Процедурный low-poly мусоровоз (длина по +Y = «нос», Z вверх), размеры в метрах. */
function box(
  pos: number[], nrm: number[], idx: number[],
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
) {
  const base = pos.length / 3;
  const faces: Array<[number[], number[]]> = [
    [[0, 0, 1], [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]],
    [[0, 0, -1], [x0, y1, z0, x1, y1, z0, x1, y0, z0, x0, y0, z0]],
    [[0, 1, 0], [x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0]],
    [[0, -1, 0], [x1, y0, z0, x1, y0, z1, x0, y0, z1, x0, y0, z0]],
    [[1, 0, 0], [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1]],
    [[-1, 0, 0], [x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1]],
  ];
  faces.forEach(([n, v], f) => {
    for (let i = 0; i < 4; i++) {
      pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      nrm.push(n[0], n[1], n[2]);
    }
    const o = base + f * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
}

export function buildTruckMesh() {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  box(pos, nrm, idx, -1.25, 1.25, -4.2, 1.0, 0.6, 3.0); // кузов
  box(pos, nrm, idx, -1.2, 1.2, 1.2, 3.0, 0.5, 2.6); // кабина
  box(pos, nrm, idx, -1.3, 1.3, -4.2, 3.0, 0.0, 0.6); // рама
  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(pos) },
      normals: { size: 3, value: new Float32Array(nrm) },
    },
    indices: { size: 1, value: new Uint16Array(idx) },
  };
}
