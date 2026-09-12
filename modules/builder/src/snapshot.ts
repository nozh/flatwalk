import * as THREE from 'three';

export type MeshSnapshot = {
  name: string;
  position: [number, number, number];
  size: [number, number, number];
};

const CM = 100;

export function roundCm(value: number) {
  return Math.round(value * CM) / CM;
}

/** World AABB of each named mesh, positions and sizes rounded to 1 cm. */
export function snapshot(root: THREE.Object3D): MeshSnapshot[] {
  root.updateWorldMatrix(true, true);
  const rows: MeshSnapshot[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.name) return;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const pos = object.getWorldPosition(new THREE.Vector3());
    rows.push({
      name: object.name,
      position: [roundCm(pos.x), roundCm(pos.y), roundCm(pos.z)],
      size: [roundCm(size.x), roundCm(size.y), roundCm(size.z)],
    });
  });
  rows.sort((a, b) => a.name.localeCompare(b.name) || compareTuple(a.position, b.position));
  return rows;
}

function compareTuple(a: [number, number, number], b: [number, number, number]) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
