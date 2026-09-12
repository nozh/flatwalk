import * as THREE from 'three';

/**
 * Empty WebGL stage in the interface palette. Builder will attach its Group here later;
 * nothing about the flat is drawn on purpose, so an empty stage never reads as a model.
 */
export function mountScenePlaceholder(container: HTMLElement): { dispose: () => void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeeefe9);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(9, 9, 12);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9dccf, 1.2));
  const grid = new THREE.GridHelper(20, 20, 0xc7ccbf, 0xdfe2d8);
  scene.add(grid);

  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(renderer.domElement);
  } catch {
    return { dispose() {} };
  }

  const resize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer?.setSize(width, height, false);
    renderer?.render(scene, camera);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  return {
    dispose() {
      observer.disconnect();
      grid.geometry.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
    },
  };
}
