import * as THREE from 'three';

export type BuilderMaterials = {
  wall: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  parquet: THREE.MeshStandardMaterial;
  tile: THREE.MeshStandardMaterial;
  laminate: THREE.MeshStandardMaterial;
  label: THREE.MeshStandardMaterial;
};

export function createMaterials(): BuilderMaterials {
  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xf1eee4, roughness: 0.92, name: 'wall' }),
    ceiling: new THREE.MeshStandardMaterial({
      color: 0xe9e7e1,
      roughness: 1,
      side: THREE.DoubleSide,
      name: 'ceiling',
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xb5d1d5,
      roughness: 0.12,
      metalness: 0.08,
      transparent: true,
      opacity: 0.45,
      name: 'glass',
    }),
    parquet: new THREE.MeshStandardMaterial({ color: 0xc5a16e, roughness: 0.65, name: 'parquet' }),
    tile: new THREE.MeshStandardMaterial({ color: 0xdbdeda, roughness: 0.48, name: 'tile' }),
    laminate: new THREE.MeshStandardMaterial({ color: 0xb8a078, roughness: 0.7, name: 'laminate' }),
    label: new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.8, name: 'label' }),
  };
}

export function floorMaterial(materials: BuilderMaterials, floor?: 'parquet' | 'tile' | 'laminate') {
  if (floor === 'tile') return materials.tile;
  if (floor === 'laminate') return materials.laminate;
  return materials.parquet;
}
