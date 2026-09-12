import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FlatModel } from '@flatwalk/contract';
import type { WalkPrep } from './walk-prep';
import { PLAYER_RADIUS, canStand, movePlayer, roomAt, type Point } from './walk-math';
import { modelText } from './view-model';

/**
 * three.js stage: Builder's Group plus lights, three camera modes and first-person controls.
 * Controls (keys, drag, pointer lock, touch nudges, sub-stepped movement) follow prototype/src/scene.ts.
 * Geometry comes only from Geometry Core via prepareWalk: start, collision segments, room polygons.
 */

export type SceneMode = 'top' | 'overview' | 'walk';

export type SceneHooks = {
  onRoom?: (roomId: string | null) => void;
  onPosition?: (point: Point, yaw: number) => void;
  onLabel?: (roomId: string) => void;
};

export type SceneController = {
  readonly mode: SceneMode;
  setMode(mode: SceneMode): void;
  enterRoom(roomId: string): boolean;
  input(code: string, down: boolean): void;
  lockMouse(): Promise<boolean>;
  pause(value: boolean): void;
  reset(): void;
  dispose(): void;
  /** Read-only diagnostics for browser checks; no state-mutating backdoor. */
  inspect(): { mode: SceneMode; player: Point; yaw: number; room: string | null; walkAvailable: boolean; meshes: number };
};

const EYE_HEIGHT = 1.6;
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

function bounds(model: FlatModel): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const points = Object.values(model.vertices);
  for (const room of Object.values(model.rooms)) points.push(room.anchor);
  if (!points.length) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[1])),
    maxZ: Math.max(...points.map((p) => p[1])),
  };
}

export function mountWalkScene(host: HTMLElement, model: FlatModel, prep: WalkPrep, hooks: SceneHooks = {}): SceneController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8e7e1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D apartment model. In walkthrough mode, use WASD or the arrow keys to move and drag to look around.');
  host.prepend(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xf5f6ff, 0xae997d, 2.0));
  const sun = new THREE.DirectionalLight(0xfff0da, 2.2);
  sun.position.set(-7, 17, 9);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdce5fa, 0.8);
  fill.position.set(8, 9, -12);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xe8e7e1, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const ceilings: THREE.Object3D[] = [];
  if (prep.scene) {
    prep.scene.group.traverse((object) => {
      if (object.name.startsWith('ceiling:')) ceilings.push(object);
      if (object.name.startsWith('label:')) object.visible = false;
    });
    scene.add(prep.scene.group);
  }

  const box = bounds(model);
  const centre = new THREE.Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
  const span = Math.max(box.maxX - box.minX, box.maxZ - box.minZ, 4);

  const perspective = new THREE.PerspectiveCamera(43, 1, 0.04, 150);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const controls = new OrbitControls(perspective, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 4;
  controls.maxDistance = Math.max(40, span * 3);
  const topControls = new OrbitControls(ortho, renderer.domElement);
  topControls.enableRotate = false;
  topControls.enableDamping = true;
  topControls.minZoom = 0.4;
  topControls.maxZoom = 6;
  topControls.enabled = false;

  const walk = prep.walk;
  const polygons = walk.polygons;
  let mode: SceneMode = 'overview';
  let player: Point = walk.available ? [walk.start.point[0], walk.start.point[1]] : [centre.x, centre.z];
  let yaw = walk.available ? Math.atan2(-walk.start.facing[0], -walk.start.facing[1]) : 0;
  let pitch = 0;
  let activeRoom: string | null = null;
  let paused = false;
  let drag: { x: number; y: number; id: number } | null = null;
  const keys = new Set<string>();
  const touch = new Set<string>();

  // Projected room labels for the top and overview modes (prototype pattern); clicking one enters that room.
  const labelLayer = document.createElement('div');
  labelLayer.className = 'room-labels';
  host.append(labelLayer);
  const labels = Object.entries(model.rooms).map(([roomId, room]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'room-label';
    const label = modelText(room.label);
    button.textContent = label;
    button.title = walk.available ? `Enter: ${label}` : label;
    button.addEventListener('click', () => hooks.onLabel?.(roomId));
    labelLayer.append(button);
    return { roomId, anchor: room.anchor, button };
  });

  function frameOverview(): void {
    const direction = new THREE.Vector3(10, 13, 14).normalize();
    const target = centre.clone().setY(0.9);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right);
    const tan = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    let fit = 0;
    for (const x of [box.minX - 0.15, box.maxX + 0.15]) {
      for (const z of [box.minZ - 0.15, box.maxZ + 0.15]) {
        for (const y of [0, model.flat.defaults.wallHeight]) {
          const p = new THREE.Vector3(x, y, z).sub(target);
          fit = Math.max(fit, Math.abs(p.dot(right)) / (tan * perspective.aspect) + p.dot(direction), Math.abs(p.dot(up)) / tan + p.dot(direction));
        }
      }
    }
    fit *= 1.14;
    controls.target.copy(target);
    perspective.position.copy(target).addScaledVector(direction, fit);
    perspective.lookAt(target);
    controls.update();
  }

  function frameTop(): void {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    const aspect = width / height;
    const half = (span / 2) * 1.12;
    if (aspect >= 1) { ortho.left = -half * aspect; ortho.right = half * aspect; ortho.top = half; ortho.bottom = -half; }
    else { ortho.left = -half; ortho.right = half; ortho.top = half / aspect; ortho.bottom = -half / aspect; }
    ortho.up.set(0, 0, -1);
    ortho.position.set(centre.x, 60, centre.z);
    ortho.lookAt(centre.x, 0, centre.z);
    ortho.zoom = 1;
    ortho.updateProjectionMatrix();
    topControls.target.copy(centre);
    topControls.update();
  }

  function updateRoom(): void {
    const room = roomAt(player, polygons);
    if (room !== activeRoom) {
      activeRoom = room;
      hooks.onRoom?.(room);
    }
    hooks.onPosition?.(player, yaw);
  }

  function setMode(next: SceneMode): void {
    mode = next;
    keys.clear();
    touch.clear();
    drag = null;
    if (document.pointerLockElement) document.exitPointerLock();
    controls.enabled = next === 'overview';
    topControls.enabled = next === 'top';
    perspective.fov = next === 'walk' ? 72 : 43;
    perspective.updateProjectionMatrix();
    for (const ceiling of ceilings) ceiling.visible = next === 'walk';
    ground.visible = next !== 'walk';
    labelLayer.hidden = next === 'walk';
    if (next === 'walk') {
      perspective.rotation.order = 'YXZ';
      renderer.domElement.focus({ preventScroll: true });
      activeRoom = null;
      updateRoom();
    } else if (next === 'overview') {
      frameOverview();
    } else {
      frameTop();
    }
  }

  function nudge(code: string): void {
    const forward = Number(['KeyW', 'ArrowUp'].includes(code)) - Number(['KeyS', 'ArrowDown'].includes(code));
    const side = Number(['KeyD', 'ArrowRight'].includes(code)) - Number(['KeyA', 'ArrowLeft'].includes(code));
    if ((forward || side) && walk.available) {
      player = movePlayer(player, [(-Math.sin(yaw) * forward + Math.cos(yaw) * side) * 0.07, (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * 0.07], walk.segments, PLAYER_RADIUS);
    }
    if (code === 'KeyQ') yaw += 0.045;
    if (code === 'KeyE') yaw -= 0.045;
    updateRoom();
  }

  const isFormTarget = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(target.tagName);
  const onKeyDown = (event: KeyboardEvent) => {
    if (mode !== 'walk' || paused || isFormTarget(event.target)) return;
    if (MOVE_CODES.has(event.code)) {
      event.preventDefault();
      if (!keys.has(event.code)) nudge(event.code);
      keys.add(event.code);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => { keys.delete(event.code); };
  const onBlur = () => { keys.clear(); touch.clear(); drag = null; };
  const onVisibility = () => { if (document.hidden) { keys.clear(); touch.clear(); } };
  const onPointerDown = (event: PointerEvent) => {
    if (mode !== 'walk' || paused) return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.focus({ preventScroll: true });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (mode !== 'walk' || paused) return;
    if (document.pointerLockElement === renderer.domElement) {
      yaw -= event.movementX * 0.003;
      pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.003, -1.15, 1.15);
    } else if (drag && drag.id === event.pointerId) {
      yaw -= (event.clientX - drag.x) * 0.005;
      pitch = THREE.MathUtils.clamp(pitch - (event.clientY - drag.y) * 0.005, -1.15, 1.15);
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
  };
  const onPointerUp = () => { drag = null; };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(type, onPointerUp);

  const resize = () => {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    perspective.aspect = width / height;
    perspective.updateProjectionMatrix();
    if (mode === 'overview') frameOverview();
    if (mode === 'top') frameTop();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let lastTime = 0;
  const projected = new THREE.Vector3();
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (mode === 'walk') {
      if (!paused && walk.available) {
        const pressed = (code: string) => keys.has(code) || touch.has(code);
        let forward = Number(pressed('KeyW') || pressed('ArrowUp')) - Number(pressed('KeyS') || pressed('ArrowDown'));
        let side = Number(pressed('KeyD') || pressed('ArrowRight')) - Number(pressed('KeyA') || pressed('ArrowLeft'));
        yaw += (Number(pressed('KeyQ')) - Number(pressed('KeyE'))) * dt * 1.5;
        const norm = Math.hypot(forward, side) || 1;
        forward /= norm;
        side /= norm;
        const speed = pressed('ShiftLeft') || pressed('ShiftRight') ? 3.2 : 1.9;
        if (forward || side) {
          player = movePlayer(player, [(-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed * dt, (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed * dt], walk.segments, PLAYER_RADIUS);
        }
      }
      perspective.position.set(player[0], EYE_HEIGHT, player[1]);
      perspective.rotation.set(pitch, yaw, 0, 'YXZ');
      updateRoom();
      renderer.render(scene, perspective);
      return;
    }
    const camera = mode === 'top' ? ortho : perspective;
    if (mode === 'top') topControls.update();
    else controls.update();
    for (const { anchor, button } of labels) {
      projected.set(anchor[0], 0.9, anchor[1]).project(camera);
      button.style.left = `${(projected.x * 0.5 + 0.5) * host.clientWidth}px`;
      button.style.top = `${(-projected.y * 0.5 + 0.5) * host.clientHeight}px`;
      button.style.visibility = Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.93 ? 'hidden' : 'visible';
    }
    renderer.render(scene, camera);
  });

  setMode('overview');

  return {
    get mode() { return mode; },
    setMode,
    enterRoom(roomId) {
      const room = model.rooms[roomId];
      if (!room || !walk.available) return false;
      const polygon = polygons[roomId];
      const candidates: Point[] = [[room.anchor[0], room.anchor[1]]];
      if (polygon) {
        candidates.push([polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length]);
      }
      const spot = candidates.find((p) => canStand(p, walk.segments, PLAYER_RADIUS) && roomAt(p, polygons) === roomId);
      if (!spot) return false;
      player = spot;
      pitch = -0.05;
      setMode('walk');
      return true;
    },
    input(code, down) {
      if (down && mode === 'walk' && !paused) {
        if (!touch.has(code)) nudge(code);
        touch.add(code);
      } else {
        touch.delete(code);
      }
    },
    async lockMouse() {
      try {
        renderer.domElement.focus({ preventScroll: true });
        await renderer.domElement.requestPointerLock();
        return true;
      } catch {
        return false;
      }
    },
    pause(value) {
      paused = value;
      keys.clear();
      touch.clear();
      drag = null;
      if (value && document.pointerLockElement) document.exitPointerLock();
    },
    reset() {
      if (walk.available) {
        player = [walk.start.point[0], walk.start.point[1]];
        yaw = Math.atan2(-walk.start.facing[0], -walk.start.facing[1]);
      }
      pitch = 0;
      setMode(mode);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      controls.dispose();
      topControls.dispose();
      labelLayer.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
    inspect() {
      return { mode, player: [player[0], player[1]], yaw, room: roomAt(player, polygons), walkAvailable: walk.available, meshes: renderer.info.render.calls };
    },
  };
}
