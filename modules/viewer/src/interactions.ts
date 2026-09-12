import type { ListingView, PhotoView } from './view-model';
import type { Overlay } from './plan-overlay';
import type { WalkPrep } from './walk-prep';
import type { ReportResult } from './load-report';
import type { SceneController, SceneHooks } from './walk-scene';
import { formatArea } from './labels';
import { facedWalls, galleryCaption, photosFor, renderGallery, renderRoomList, renderRoomPanel, renderStageStatus, type Selection, type StageView } from './panels';

export type ListingController = {
  select(selection: Selection): void;
  dispose(): void;
  /** Read-only scene diagnostics for browser checks; null until a scene is mounted. */
  inspect(): ReturnType<SceneController['inspect']> | null;
};

type PlaceholderMount = (container: HTMLElement) => { dispose(): void };
type WalkMount = (container: HTMLElement, hooks: SceneHooks) => SceneController;

export type ListingDeps = {
  /** Empty three.js stage used while Builder has no scene for this model. */
  mountScene?: PlaceholderMount;
  /** Builder scene with Geometry Core walk; used when prep.scene exists. */
  mountWalk?: WalkMount;
  prep?: WalkPrep;
  /** Validator report of the shown revision; drives the trial/ready wording. */
  report?: ReportResult;
};

const wrap = (index: number, length: number) => (index + length) % length;

/** Dialog helpers follow prototype/src/main.ts: showModal when available, close on backdrop click. */
function showDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function hideDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog || !dialog.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function clickedBackdrop(dialog: HTMLDialogElement, event: MouseEvent): boolean {
  if (event.target !== dialog) return false;
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

export function mountListing(root: HTMLElement, view: ListingView, deps: ListingDeps = {}): ListingController {
  const app = root.querySelector<HTMLElement>('.app');
  const roomList = root.querySelector<HTMLElement>('#room-list');
  const panel = root.querySelector<HTMLElement>('#room-panel');
  const stagePlan = root.querySelector<HTMLElement>('#stage-plan');
  const stageScene = root.querySelector<HTMLElement>('#stage-scene');
  const sceneSlot = root.querySelector<HTMLElement>('#scene-slot');
  const stageStatus = root.querySelector<HTMLElement>('#stage-status');
  const stage = root.querySelector<HTMLElement>('.stage');
  const hud = root.querySelector<HTMLElement>('#walk-hud');
  const hudRoom = root.querySelector<HTMLElement>('#hud-room');
  const hudArea = root.querySelector<HTMLElement>('#hud-area');
  const walkButton = root.querySelector<HTMLButtonElement>('button[data-action="walk"]');
  const about = root.querySelector<HTMLDialogElement>('#about-dialog');
  const lightbox = root.querySelector<HTMLDialogElement>('#lightbox');
  const lightboxImage = root.querySelector<HTMLImageElement>('#lightbox-image');
  const lightboxCaption = root.querySelector<HTMLElement>('#lightbox-caption');
  const toast = root.querySelector<HTMLElement>('#toast');
  const overlayMode = (stagePlan?.dataset.mode ?? 'empty') as Overlay['mode'];
  const prep = deps.prep;
  const walkAvailable = Boolean(prep?.walk.available);
  const walkable = (roomId: string) => walkAvailable && Boolean(prep?.walk.polygons[roomId]);

  let selected: Selection = 'all';
  let galleryIndex = 0;
  let activeView: StageView = 'plan';
  let lastSceneView: 'top' | 'scene' = 'scene';
  let scene: SceneController | undefined;
  let placeholder: { dispose(): void } | undefined;
  let shown: { set: PhotoView[]; index: number; scope: string | null } | null = null;
  let toastTimer: number | undefined;

  const currentSet = () => photosFor(view, selected);

  function notify(text: string): void {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function updateMarks(): void {
    const faced = new Set(selected === 'all' ? [] : facedWalls(view, selected));
    for (const room of root.querySelectorAll<SVGElement>('[data-room]')) {
      const active = room.dataset.room === selected;
      room.classList.toggle('is-selected', active);
      room.setAttribute('aria-pressed', String(active));
    }
    for (const wall of root.querySelectorAll<SVGElement>('[data-wall]')) {
      wall.classList.toggle('is-faced', faced.has(wall.dataset.wall ?? ''));
    }
  }

  function select(next: Selection, scroll = true): void {
    selected = view.rooms.some((room) => room.id === next) ? next : 'all';
    galleryIndex = 0;
    if (roomList) roomList.innerHTML = renderRoomList(view, selected);
    if (panel) panel.innerHTML = renderRoomPanel(view, selected, { walkable });
    updateMarks();
    if (scroll && selected !== 'all' && panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function pick(index: number): void {
    const set = currentSet();
    if (!set.length) return;
    galleryIndex = wrap(index, set.length);
    const gallery = root.querySelector<HTMLElement>('#gallery');
    if (gallery) gallery.innerHTML = renderGallery(set, galleryIndex);
  }

  function renderLightbox(): void {
    if (!shown || !lightboxImage || !lightboxCaption) return;
    const photo = shown.set[shown.index];
    if (!photo) return;
    lightboxImage.src = photo.url;
    lightboxImage.alt = photo.roomLabel ? `Photo ${photo.number}, ${photo.roomLabel}` : `Photo ${photo.number}`;
    const parts = shown.scope
      ? [`${shown.scope}, ${shown.index + 1} of ${shown.set.length}`, `photo ${photo.number}`]
      : [`Photo ${photo.number} of ${shown.set.length}`, ...(photo.roomLabel ? [photo.roomLabel] : [])];
    if (photo.lookLabel) parts.push(photo.lookLabel);
    const question = photo.question ? ` Model question: ${photo.question}` : '';
    lightboxCaption.textContent = `${parts.join(', ')}.${question}`;
    for (const button of lightbox?.querySelectorAll<HTMLButtonElement>('.lightbox-nav') ?? []) button.disabled = shown.set.length < 2;
  }

  function openLightbox(set: PhotoView[], index: number): void {
    if (!set.length) return;
    const scope = selected === 'all' ? null : view.rooms.find((room) => room.id === selected)?.label ?? null;
    shown = { set, index: wrap(index, set.length), scope };
    renderLightbox();
    scene?.pause(true);
    showDialog(lightbox);
  }

  function stepLightbox(delta: number): void {
    if (!shown) return;
    shown.index = wrap(shown.index + delta, shown.set.length);
    renderLightbox();
  }

  function closeLightbox(): void {
    hideDialog(lightbox);
    shown = null;
  }

  // ----- stage: plan, top, overview, walk -----

  const hooks: SceneHooks = {
    onRoom(roomId) {
      const room = roomId ? view.rooms.find((item) => item.id === roomId) : undefined;
      if (hudRoom) hudRoom.textContent = room ? room.label : 'Outside rooms';
      const area = roomId && prep?.walk.areas?.rooms[roomId];
      if (hudArea) hudArea.textContent = area ? `≈ ${formatArea(area)} in the model` : '';
      if (room && selected !== room.id) select(room.id);
    },
    onLabel(roomId) {
      enterRoom(roomId);
    },
  };

  function ensureScene(): SceneController | undefined {
    if (scene || !sceneSlot) return scene;
    if (prep?.scene && deps.mountWalk) {
      scene = deps.mountWalk(sceneSlot, hooks);
      return scene;
    }
    if (!placeholder && deps.mountScene) placeholder = deps.mountScene(sceneSlot);
    return undefined;
  }

  function showView(next: StageView): void {
    activeView = next;
    app?.setAttribute('data-view', next);
    if (stagePlan) stagePlan.hidden = next !== 'plan';
    if (stageScene) stageScene.hidden = next === 'plan';
    if (hud) hud.hidden = next !== 'walk';
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === next));
    }
    const label = walkButton?.querySelector('.walk-label');
    if (label) label.textContent = next === 'walk' ? 'Exit walkthrough' : (walkButton?.dataset.label ?? 'Walkthrough');
    if (stageStatus) stageStatus.textContent = renderStageStatus(next, overlayMode, prep, undefined, deps.report);
  }

  function switchView(next: 'plan' | 'top' | 'scene'): void {
    if (next === 'plan') { showView('plan'); return; }
    if (next === 'top' && !prep?.scene) return;
    lastSceneView = next;
    const controller = ensureScene();
    controller?.setMode(next === 'top' ? 'top' : 'overview');
    showView(next);
  }

  function focusCanvas(): void {
    sceneSlot?.querySelector<HTMLElement>('canvas')?.focus({ preventScroll: true });
  }

  /** On stacked mobile layout the listing sits below the canvas; entering walk must not leave the HUD off-screen. */
  function bringStageIntoView(): void {
    root.querySelector<HTMLElement>('.stage-canvas')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function startWalk(): void {
    if (!walkAvailable) return;
    const controller = ensureScene();
    if (!controller) return;
    // Show the stage first: focusing a canvas inside a hidden container fails and keys would stay on the toolbar button.
    showView('walk');
    controller.setMode('walk');
    bringStageIntoView();
    focusCanvas();
  }

  function exitWalk(): void {
    if (activeView !== 'walk') return;
    scene?.setMode(lastSceneView === 'top' ? 'top' : 'overview');
    showView(lastSceneView);
  }

  function enterRoom(roomId: string): void {
    if (!walkable(roomId)) return;
    const controller = ensureScene();
    if (!controller) return;
    showView('walk');
    if (controller.enterRoom(roomId)) {
      bringStageIntoView();
      focusCanvas();
    }
    else { showView(lastSceneView); notify('No valid standing point was found in this room'); }
  }

  function toggleMarks(button: HTMLButtonElement): void {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    app?.setAttribute('data-marks', on ? 'on' : 'off');
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage) await stage.requestFullscreen();
    } catch {
      notify('Full-screen mode is unavailable in this browser');
    }
  }

  async function lockMouse(): Promise<void> {
    const controller = ensureScene();
    if (!controller || !(await controller.lockMouse())) notify('Drag on the 3D scene to look around');
  }

  function photoIndexIn(set: PhotoView[], id: string): number {
    return Math.max(0, set.findIndex((photo) => photo.id === id));
  }

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const button = target.closest<HTMLButtonElement>('button');
    if (button?.disabled) return;

    const selectButton = target.closest<HTMLElement>('[data-select]');
    if (selectButton?.dataset.select) { select(selectButton.dataset.select); return; }

    const roomMark = target.closest<SVGElement>('[data-room]');
    if (roomMark?.dataset.room && !roomMark.hasAttribute('data-action')) { select(roomMark.dataset.room); return; }

    const thumb = target.closest<HTMLElement>('.thumb[data-photo]');
    if (thumb?.dataset.photo) {
      const set = currentSet();
      if (thumb.classList.contains('is-picker')) pick(photoIndexIn(set, thumb.dataset.photo));
      else openLightbox(set, photoIndexIn(set, thumb.dataset.photo));
      return;
    }

    const hero = target.closest<HTMLElement>('.photo-main[data-photo]');
    if (hero) { openLightbox(currentSet(), galleryIndex); return; }

    const viewButton = target.closest<HTMLButtonElement>('button[data-view]');
    const nextView = viewButton?.dataset.view;
    if (nextView === 'plan' || nextView === 'top' || nextView === 'scene') { switchView(nextView); return; }

    const actionButton = target.closest<HTMLButtonElement>('[data-action]');
    switch (actionButton?.dataset.action) {
      case 'gallery-prev': pick(galleryIndex - 1); break;
      case 'gallery-next': pick(galleryIndex + 1); break;
      case 'lightbox-prev': stepLightbox(-1); break;
      case 'lightbox-next': stepLightbox(1); break;
      case 'lightbox-close': closeLightbox(); break;
      case 'about': scene?.pause(true); showDialog(about); break;
      case 'toggle-marks': toggleMarks(actionButton as HTMLButtonElement); break;
      case 'fullscreen': void toggleFullscreen(); break;
      case 'walk': if (activeView === 'walk') exitWalk(); else startWalk(); break;
      case 'walk-exit': exitWalk(); break;
      case 'enter-room': if (actionButton?.dataset.room) enterRoom(actionButton.dataset.room); break;
      case 'lock-mouse': void lockMouse(); break;
      default: break;
    }
  };

  const onRootKeydown = (event: KeyboardEvent) => {
    const roomMark = (event.target as HTMLElement | null)?.closest?.<SVGElement>('[data-room]');
    if (roomMark?.dataset.room && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select(roomMark.dataset.room);
    }
  };

  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (lightbox?.open) {
      if (event.key === 'ArrowRight') { event.preventDefault(); stepLightbox(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); stepLightbox(-1); }
      else if (event.key === 'Escape') { event.preventDefault(); closeLightbox(); }
      return;
    }
    if (about?.open) return;
    if (event.key === 'Escape' && activeView === 'walk' && !document.pointerLockElement) exitWalk();
  };

  const hot = (event: Event, on: boolean) => {
    const source = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-photo][data-faces]');
    const wallId = source?.dataset.faces;
    if (!wallId) return;
    root.querySelector(`[data-wall="${wallId}"]`)?.classList.toggle('is-hot', on);
  };
  const onOver = (event: Event) => hot(event, true);
  const onOut = (event: Event) => hot(event, false);

  // Touch nudges for the walk (prototype pattern): press to step, release to stop.
  const touchKey = (event: Event) => (event.target as HTMLElement | null)?.closest?.<HTMLElement>('#walk-hud [data-key]')?.dataset.key;
  const onPointerDown = (event: Event) => {
    const code = touchKey(event);
    if (!code) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (typeof target.setPointerCapture === 'function' && 'pointerId' in event) {
      try { target.setPointerCapture((event as PointerEvent).pointerId); } catch { /* not supported */ }
    }
    scene?.input(code, true);
  };
  const onPointerUp = (event: Event) => {
    const code = touchKey(event);
    if (code) scene?.input(code, false);
  };

  const onLightboxClick = (event: Event) => { if (lightbox && clickedBackdrop(lightbox, event as MouseEvent)) closeLightbox(); };
  const onAboutClick = (event: Event) => { if (about && clickedBackdrop(about, event as MouseEvent)) hideDialog(about); };
  const onDialogClose = () => { shown = null; scene?.pause(false); };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onRootKeydown);
  root.addEventListener('mouseover', onOver);
  root.addEventListener('mouseout', onOut);
  root.addEventListener('focusin', onOver);
  root.addEventListener('focusout', onOut);
  root.addEventListener('pointerdown', onPointerDown);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(type, onPointerUp);
  document.addEventListener('keydown', onDocumentKeydown);
  lightbox?.addEventListener('click', onLightboxClick);
  lightbox?.addEventListener('close', onDialogClose);
  about?.addEventListener('click', onAboutClick);
  about?.addEventListener('close', onDialogClose);

  select('all');
  showView('plan');

  return {
    select: (next) => select(next),
    inspect: () => scene?.inspect() ?? null,
    dispose() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onRootKeydown);
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseout', onOut);
      root.removeEventListener('focusin', onOver);
      root.removeEventListener('focusout', onOut);
      root.removeEventListener('pointerdown', onPointerDown);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) root.removeEventListener(type, onPointerUp);
      document.removeEventListener('keydown', onDocumentKeydown);
      lightbox?.removeEventListener('click', onLightboxClick);
      lightbox?.removeEventListener('close', onDialogClose);
      about?.removeEventListener('click', onAboutClick);
      about?.removeEventListener('close', onDialogClose);
      window.clearTimeout(toastTimer);
      scene?.dispose();
      scene = undefined;
      placeholder?.dispose();
      placeholder = undefined;
    },
  };
}
