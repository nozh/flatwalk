import type { ListingView, PhotoView } from './view-model';
import type { Overlay } from './plan-overlay';
import { facedWalls, galleryCaption, photosFor, renderGallery, renderRoomList, renderRoomPanel, renderStageStatus, type Selection } from './panels';

export type ListingController = {
  select(selection: Selection): void;
  dispose(): void;
};

type SceneMount = (container: HTMLElement) => { dispose(): void };

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

export function mountListing(root: HTMLElement, view: ListingView, deps: { mountScene?: SceneMount } = {}): ListingController {
  const app = root.querySelector<HTMLElement>('.app');
  const roomList = root.querySelector<HTMLElement>('#room-list');
  const panel = root.querySelector<HTMLElement>('#room-panel');
  const stagePlan = root.querySelector<HTMLElement>('#stage-plan');
  const stageScene = root.querySelector<HTMLElement>('#stage-scene');
  const sceneSlot = root.querySelector<HTMLElement>('#scene-slot');
  const stageStatus = root.querySelector<HTMLElement>('#stage-status');
  const stage = root.querySelector<HTMLElement>('.stage');
  const about = root.querySelector<HTMLDialogElement>('#about-dialog');
  const lightbox = root.querySelector<HTMLDialogElement>('#lightbox');
  const lightboxImage = root.querySelector<HTMLImageElement>('#lightbox-image');
  const lightboxCaption = root.querySelector<HTMLElement>('#lightbox-caption');
  const toast = root.querySelector<HTMLElement>('#toast');
  const overlayMode = (stagePlan?.dataset.mode ?? 'empty') as Overlay['mode'];

  let selected: Selection = 'all';
  let galleryIndex = 0;
  let activeView: 'plan' | 'scene' = 'plan';
  let scene: { dispose(): void } | undefined;
  let shown: { set: PhotoView[]; index: number } | null = null;
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

  function select(next: Selection): void {
    selected = view.rooms.some((room) => room.id === next) ? next : 'all';
    galleryIndex = 0;
    if (roomList) roomList.innerHTML = renderRoomList(view, selected);
    if (panel) panel.innerHTML = renderRoomPanel(view, selected);
    updateMarks();
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
    lightboxImage.alt = photo.roomLabel ? `Фото ${photo.number}, ${photo.roomLabel}` : `Фото ${photo.number}`;
    const parts = [`Фото ${photo.number} из ${shown.set.length}`];
    if (photo.roomLabel) parts.push(photo.roomLabel);
    if (photo.lookLabel) parts.push(photo.lookLabel);
    const question = photo.question ? ` Вопрос модели: ${photo.question}` : '';
    lightboxCaption.textContent = `${parts.join(', ')}.${question}`;
    for (const button of lightbox?.querySelectorAll<HTMLButtonElement>('.lightbox-nav') ?? []) button.disabled = shown.set.length < 2;
  }

  function openLightbox(set: PhotoView[], index: number): void {
    if (!set.length) return;
    shown = { set, index: wrap(index, set.length) };
    renderLightbox();
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

  function switchView(next: 'plan' | 'scene'): void {
    activeView = next;
    app?.setAttribute('data-view', next);
    if (stagePlan) stagePlan.hidden = next === 'scene';
    if (stageScene) stageScene.hidden = next === 'plan';
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === next));
    }
    if (stageStatus) stageStatus.textContent = renderStageStatus(next, overlayMode);
    if (next === 'scene' && !scene && sceneSlot && deps.mountScene) scene = deps.mountScene(sceneSlot);
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
      notify('Полноэкранный режим недоступен в этом браузере');
    }
  }

  function photoIndexIn(set: PhotoView[], id: string): number {
    return Math.max(0, set.findIndex((photo) => photo.id === id));
  }

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const selectButton = target.closest<HTMLElement>('[data-select]');
    if (selectButton?.dataset.select) { select(selectButton.dataset.select); return; }

    const roomMark = target.closest<SVGElement>('[data-room]');
    if (roomMark?.dataset.room) { select(roomMark.dataset.room); return; }

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
    if (viewButton?.dataset.view === 'plan' || viewButton?.dataset.view === 'scene') { switchView(viewButton.dataset.view); return; }

    const action = target.closest<HTMLButtonElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'gallery-prev': pick(galleryIndex - 1); break;
      case 'gallery-next': pick(galleryIndex + 1); break;
      case 'lightbox-prev': stepLightbox(-1); break;
      case 'lightbox-next': stepLightbox(1); break;
      case 'lightbox-close': closeLightbox(); break;
      case 'about': showDialog(about); break;
      case 'toggle-marks': toggleMarks(target.closest('[data-action]') as HTMLButtonElement); break;
      case 'fullscreen': void toggleFullscreen(); break;
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
    if (!lightbox?.open) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); stepLightbox(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); stepLightbox(-1); }
    else if (event.key === 'Escape') { event.preventDefault(); closeLightbox(); }
  };

  const hot = (event: Event, on: boolean) => {
    const source = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-photo][data-faces]');
    const wallId = source?.dataset.faces;
    if (!wallId) return;
    root.querySelector(`[data-wall="${wallId}"]`)?.classList.toggle('is-hot', on);
  };
  const onOver = (event: Event) => hot(event, true);
  const onOut = (event: Event) => hot(event, false);

  const onLightboxClick = (event: Event) => { if (lightbox && clickedBackdrop(lightbox, event as MouseEvent)) closeLightbox(); };
  const onAboutClick = (event: Event) => { if (about && clickedBackdrop(about, event as MouseEvent)) hideDialog(about); };
  const onLightboxClose = () => { shown = null; };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onRootKeydown);
  root.addEventListener('mouseover', onOver);
  root.addEventListener('mouseout', onOut);
  root.addEventListener('focusin', onOver);
  root.addEventListener('focusout', onOut);
  document.addEventListener('keydown', onDocumentKeydown);
  lightbox?.addEventListener('click', onLightboxClick);
  lightbox?.addEventListener('close', onLightboxClose);
  about?.addEventListener('click', onAboutClick);

  select('all');
  switchView(activeView);

  return {
    select,
    dispose() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onRootKeydown);
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseout', onOut);
      root.removeEventListener('focusin', onOver);
      root.removeEventListener('focusout', onOut);
      document.removeEventListener('keydown', onDocumentKeydown);
      lightbox?.removeEventListener('click', onLightboxClick);
      lightbox?.removeEventListener('close', onLightboxClose);
      about?.removeEventListener('click', onAboutClick);
      window.clearTimeout(toastTimer);
      scene?.dispose();
      scene = undefined;
    },
  };
}
