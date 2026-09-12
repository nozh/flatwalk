import type { DataSource } from './source';
import type { ListingView, PhotoView } from './view-model';
import type { ReportResult } from './load-report';
import type { Overlay } from './plan-overlay';
import type { WalkPrep } from './walk-prep';
import { walkVerification, type WalkVerification } from './report-status';
import { countLabel, formatArea, formatMeters, formatPercent } from './labels';
import { escapeHtml, icon } from './html';

export type Selection = 'all' | string;

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Photos shown for a selection: the whole gallery for the flat, bound photos for a room. */
export function photosFor(view: ListingView, selected: Selection): PhotoView[] {
  if (selected === 'all') return view.photos;
  return view.photos.filter((photo) => photo.roomId === selected);
}

export function facedWalls(view: ListingView, selected: Selection): string[] {
  const walls = photosFor(view, selected).map((photo) => photo.faces).filter((wall): wall is string => wall !== null);
  return [...new Set(walls)];
}

function photoAlt(photo: PhotoView): string {
  return photo.roomLabel ? `Photo ${photo.number}, ${photo.roomLabel}` : `Photo ${photo.number}`;
}

function facesAttr(photo: PhotoView): string {
  return photo.faces ? ` data-faces="${escapeHtml(photo.faces)}"` : '';
}

/** Grid of photos; every thumbnail opens the lightbox. */
function renderThumbGrid(photos: PhotoView[]): string {
  return `<div class="thumbs is-grid">${photos.map((photo) => `
    <button type="button" class="thumb" data-photo="${escapeHtml(photo.id)}"${facesAttr(photo)} aria-label="Open ${escapeHtml(photoAlt(photo).toLowerCase())}">
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photoAlt(photo))}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" />
      <span class="thumb-number">${photo.number}</span>
    </button>`).join('')}</div>`;
}

export function galleryCaption(photo: PhotoView): string {
  const parts = [`Photo ${photo.number}`];
  if (photo.lookLabel) parts.push(photo.lookLabel);
  return parts.join(', ');
}

/** Hero photo with wraparound navigation and picker thumbnails (pattern from prototype/src/main.ts renderPhoto). */
export function renderGallery(photos: PhotoView[], index: number): string {
  const photo = photos[index];
  if (!photo) return '';
  const thumbs = photos.map((item, i) => `
    <button type="button" class="thumb is-picker" data-photo="${escapeHtml(item.id)}"${facesAttr(item)} aria-pressed="${i === index}" aria-label="Show ${escapeHtml(photoAlt(item).toLowerCase())}">
      <img src="${escapeHtml(item.url)}" alt="" width="${item.width}" height="${item.height}" loading="lazy" decoding="async" />
    </button>`).join('');
  return `<button type="button" class="photo-main" data-photo="${escapeHtml(photo.id)}"${facesAttr(photo)} aria-label="Open ${escapeHtml(photoAlt(photo).toLowerCase())} full size">
      <img id="gallery-image" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photoAlt(photo))}" width="${photo.width}" height="${photo.height}" decoding="async" />
      <span class="photo-zoom" aria-hidden="true">${icon('expand')}</span>
      <span class="photo-counter" id="gallery-counter">${index + 1} / ${photos.length}</span>
    </button>
    <div class="gallery-nav">
      <span class="gallery-caption" id="gallery-caption">${escapeHtml(galleryCaption(photo))}</span>
      <span class="gallery-buttons">
        <button type="button" class="icon-button" data-action="gallery-prev" aria-label="Previous photo"${photos.length < 2 ? ' disabled' : ''}>${icon('left')}</button>
        <button type="button" class="icon-button" data-action="gallery-next" aria-label="Next photo"${photos.length < 2 ? ' disabled' : ''}>${icon('right')}</button>
      </span>
    </div>
    ${photos.length > 1 ? `<div class="thumbs is-picker-row">${thumbs}</div>` : ''}`;
}

export function renderRoomList(view: ListingView, selected: Selection): string {
  const all = `<button type="button" class="room-row is-all" data-select="all" aria-current="${selected === 'all'}">
      <span class="room-name">Entire apartment</span>
      <span class="room-count">${view.photos.length ? countLabel(view.photos.length, ['photo', 'photos', 'photos']) : 'no photos'}</span>
    </button>`;
  const rooms = view.rooms.map((room) => `<button type="button" class="room-row" data-select="${escapeHtml(room.id)}" aria-current="${selected === room.id}">
      <span class="room-name">${escapeHtml(room.label)}${room.question ? `<span class="room-question" title="${escapeHtml(room.question)}" aria-label="Open question">${icon('question')}</span>` : ''}</span>
      <span class="room-count">${room.photoIds.length ? countLabel(room.photoIds.length, ['photo', 'photos', 'photos']) : ''}</span>
    </button>`).join('');
  return `<h2 class="sidebar-title">Rooms</h2>${all}${rooms || '<p class="panel-note">The model has no rooms.</p>'}`;
}

function flatLead(view: ListingView): string {
  const declared: string[] = [];
  if (view.flat.areaDeclared !== undefined) declared.push(formatArea(view.flat.areaDeclared));
  if (view.flat.roomsDeclared !== undefined) declared.push(`${number.format(view.flat.roomsDeclared)} ${view.flat.roomsDeclared === 1 ? 'room' : 'rooms'}`);
  const first = declared.length ? `${declared.join(' and ')} in the listing.` : 'The listing does not specify the area or number of rooms.';
  const rooms = countLabel(view.flat.roomCount, ['room', 'rooms', 'rooms']);
  const photos = view.flat.photoCount
    ? `and ${countLabel(view.flat.photoCount, ['photo', 'photos', 'photos'])}`
    : 'and no photos';
  return `${first} The model contains ${rooms} ${photos}.`;
}

export type PanelOptions = {
  /** Whether the walk can start inside the room: Geometry Core gave it a polygon and a start exists. */
  walkable?: (roomId: string) => boolean;
};

export function renderRoomPanel(view: ListingView, selected: Selection, options: PanelOptions = {}): string {
  if (selected === 'all') {
    const photos = view.photos.length
      ? `<h3 class="panel-section">All photos</h3>${renderThumbGrid(view.photos)}`
      : `<p class="panel-note">The model has no photos.</p>`;
    return `<header class="panel-head"><h2>Entire apartment</h2><p class="panel-lead">${escapeHtml(flatLead(view))}</p></header>${photos}`;
  }

  const room = view.rooms.find((item) => item.id === selected);
  if (!room) return `<p class="panel-note">Room not found.</p>`;
  const origin = [room.basisLabel.charAt(0).toUpperCase() + room.basisLabel.slice(1)];
  if (room.confidence !== undefined) origin.push(`${formatPercent(room.confidence)} confidence`);
  if (room.reviewed) origin.push('human-confirmed');

  let gallery: string;
  if (!view.photosBound) {
    gallery = `<p class="panel-note">Photos have not yet been assigned to rooms.</p><button type="button" class="link-button" data-select="all">View all photos</button>`;
  } else if (room.photoIds.length === 0) {
    gallery = `<p class="panel-note">No photos are assigned to this room.</p>`;
  } else {
    const photos = photosFor(view, selected);
    gallery = `<h3 class="panel-section">${countLabel(photos.length, ['photo', 'photos', 'photos'])}</h3><div class="gallery" id="gallery">${renderGallery(photos, 0)}</div>`;
  }

  const enter = options.walkable?.(room.id)
    ? `<button type="button" class="enter-room" data-action="enter-room" data-room="${escapeHtml(room.id)}">${icon('walk')}Enter room${icon('arrow')}</button>`
    : '';
  return `<header class="panel-head">
      <h2>${escapeHtml(room.label)}</h2>
      <p class="panel-sub">${escapeHtml(room.typeLabel)}</p>
      <p class="panel-origin">${escapeHtml(origin.join(', '))}.</p>
      ${room.question ? `<p class="panel-question"><span class="panel-question-mark">${icon('question')}</span><span><b>Model question.</b> ${escapeHtml(room.question)}</span></p>` : ''}
      ${enter}
    </header>${gallery}`;
}

function scaleSentence(view: ListingView): string {
  if (view.plan.pxPerMeter === undefined) return 'Floor-plan scale is unknown.';
  const parts = [`Floor-plan scale ${view.plan.basisLabel}`];
  if (view.plan.confidence !== undefined) parts.push(`${formatPercent(view.plan.confidence)} confidence`);
  if (view.plan.reviewed) parts.push('human-confirmed');
  return `${parts.join(', ')}.`;
}

function ceilingSentence(view: ListingView): string {
  const ceiling = view.assumptions[0];
  if (!ceiling) return '';
  const value = formatMeters(view.flat.wallHeight);
  if (ceiling.basisLabel === 'default assumption') return `Ceiling height ${value} is a default assumption.`;
  return `Ceiling height ${value} (${ceiling.basisLabel}).`;
}

function verificationSentence(report: ReportResult): string {
  return walkVerification(report).headline;
}

export function renderAssumptionStrip(view: ListingView, report: ReportResult): string {
  const sentences = [scaleSentence(view), ceilingSentence(view)];
  if (view.questions.length) sentences.push(`Open questions: ${view.questions.length}.`);
  sentences.push(verificationSentence(report));
  return `<p class="assumptions-text">${sentences.filter(Boolean).map(escapeHtml).join(' ')}</p>
    <button type="button" class="text-button" data-action="about">${icon('info')}Details</button>`;
}

/** Validator messages name rooms by id; the dialog shows the room label instead. Other ids stay as they are. */
function humanizeIds(text: string, view: ListingView): string {
  const byId = new Map(view.rooms.map((room) => [room.id, room.label]));
  return text
    .replace(/\brooms\.(r\d+)\b/g, (match, id: string) => (byId.has(id) ? `«${byId.get(id)}»` : match))
    .replace(/\b(r\d+)\b/g, (match, id: string) => (byId.has(id) ? `«${byId.get(id)}»` : match));
}

function reportSection(report: ReportResult, view: ListingView): string {
  if (report.status === 'missing') {
    return `<p>No Validator report was found for this revision. Room connectivity, clearance, and scale are unverified; room areas are not confirmed.</p>`;
  }
  if (report.status === 'stale') {
    return `<p>A validation report was found, but it belongs to another model or revision and is ignored. Room connectivity and clearance are unverified.</p>`;
  }
  if (report.status === 'invalid') return `<p>The report file does not match the contract and is ignored. Room connectivity and clearance are unverified.</p>`;

  const { report: data } = report;
  const verification = walkVerification(report);
  const human = (text: string) => escapeHtml(humanizeIds(text, view));
  const byStatus = (status: string) => data.checks.filter((check) => check.status === status);
  const count = (status: string) => byStatus(status).length;
  const totals = [
    `${count('pass')} passed`, `${count('fail')} failed`, `${count('unverified')} unverified`, `${count('skipped')} skipped`,
  ];
  const list = (status: string, className: string, title: string) => {
    const items = byStatus(status);
    if (!items.length) return '';
    return `<p class="about-list-title">${title}</p><ul class="${className}">${items.map((check) => `<li>${human(check.message || check.checkId)}</li>`).join('')}</ul>`;
  };
  return `<p><b>${escapeHtml(verification.headline)}</b></p>
    <ul class="about-navigation">${verification.lines.map((item) => `<li>${human(item)}</li>`).join('')}</ul>
    <p>Confirmed model data: ${formatPercent(data.confirmation)} (entities confirmed by a person or with confidence of at least 0.6; this is not the share of passed checks or measurements).</p>
    <p>${data.checks.length} checks: ${escapeHtml(totals.join(', '))}. Report for model ${escapeHtml(data.modelId)}, revision ${data.revision}.</p>
    ${list('fail', 'about-failed', 'Failed')}
    ${list('unverified', 'about-unverified', 'Unverified: insufficient data; this does not mean passed')}
    ${list('skipped', 'about-skipped', 'Skipped: this check is not run in the current slice')}
    ${data.review.items.length ? `<p>${countLabel(data.review.items.length, ['review item', 'review items', 'review items'])}:</p><ul class="about-review">${data.review.items.map((item) => `<li>${human(item.reason)}${item.suggestion ? ` <span class="muted">${human(item.suggestion)}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
}

export function renderAbout(
  view: ListingView,
  report: ReportResult,
  source: DataSource,
  prep?: WalkPrep,
  options: { demo?: boolean; synthetic?: boolean; syntheticFixture?: boolean } = {},
): string {
  const link = view.source.url && !options.synthetic && !options.syntheticFixture
    ? ` <a href="${escapeHtml(view.source.url)}" target="_blank" rel="noopener noreferrer">Open listing${icon('external')}</a>`
    : '';
  const demoNote = options.synthetic
    ? '<p><b>This is Viewer test data, not a listing apartment.</b> It must not be presented as CityExpert 54541.</p>'
    : options.syntheticFixture
      ? '<p><b>Synthetic fixture geometry.</b> grok-rects placeholder rooms, not recognition of listing 54541. Listing photos shown beside this model are source materials only.</p>'
      : options.demo
        ? '<p><b>Prepared demo of reference 54541.</b> The listing URL is not fetched or recognized in this static showcase.</p>'
        : '';
  const mode = options.synthetic
    ? 'Static mode: synthetic Viewer test model. Changes are not saved and Convex is not connected.'
    : options.syntheticFixture
      ? 'Job result: fixture adapters produced synthetic grok-rects geometry. Changes are not saved. Listing photos were not used to infer these walls.'
      : source.kind === 'fixture'
        ? 'Static mode: bundled prepared demo of reference 54541. Changes are not saved and Convex is not connected.'
        : source.kind === 'job'
          ? 'Job result loaded from the local job API. Changes are not saved and Convex is not connected.'
          : 'Static mode: model loaded from the run folder. Changes are not saved and Convex is not connected.';
  const questions = view.questions.length
    ? `<ul class="about-questions">${view.questions.map((question) => `<li><b>${escapeHtml(question.subject)}.</b> ${escapeHtml(question.text)}</li>`).join('')}</ul>`
    : '<p>No open questions.</p>';

  return `<form method="dialog" class="dialog-head">
      <h2 id="about-title">About the model</h2>
      <button type="submit" class="icon-button" aria-label="Close">${icon('close')}</button>
    </form>
    <div class="dialog-body">
      <section>
        <h3>Data sources</h3>
        ${demoNote}
        <p>${escapeHtml(view.source.siteLabel)}, retrieved ${escapeHtml(view.source.fetchedAtLabel)}.${link}</p>
        <p>Model provenance: ${escapeHtml(view.provenance.join(', ') || 'not specified')}.</p>
        <p class="muted">Model ${escapeHtml(view.id)}, revision ${view.revision}.</p>
      </section>
      <section>
        <h3>Assumptions without measurements</h3>
        <p>${escapeHtml(scaleSentence(view))}</p>
        <ul class="about-defaults">${view.assumptions.map((item) => `<li>${escapeHtml(item.subject)} ${escapeHtml(item.value)}, ${escapeHtml(item.basisLabel)}${item.reviewed ? ', confirmed' : ''}.</li>`).join('')}</ul>
      </section>
      <section>
        <h3>Open questions${view.questions.length ? ` (${view.questions.length})` : ''}</h3>
        ${questions}
      </section>
      <section>
        <h3>Validation</h3>
        ${reportSection(report, view)}
      </section>
      <section>
        <h3>Geometry and scene</h3>
        ${prep
          ? `<ul class="about-geometry">${prep.diagnostics.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
          : '<p>The 3D scene was not built because Builder is not connected.</p>'}
      </section>
      <section>
        <h3>Mode</h3>
        <p>${escapeHtml(mode)}</p>
      </section>
    </div>`;
}

export type StageView = 'plan' | 'top' | 'scene' | 'walk';

/** «Прогулка готова» appears only when the report confirmed clearance; otherwise the walk stays a trial. */
export function walkTitle(verification?: WalkVerification): string {
  return verification?.level === 'ready' ? 'Walkthrough' : 'Trial walkthrough';
}

export function renderStageStatus(activeView: StageView, mode: Overlay['mode'], prep?: WalkPrep, revision?: number, report?: ReportResult): string {
  if (activeView !== 'plan') {
    if (!prep) return 'The 3D scene has not been built: Builder is not connected and the scene is empty.';
    if (!prep.scene) return `The 3D scene has not been built: ${prep.sceneError ?? 'Builder did not build the model'}.`;
    const verification = walkVerification(report ?? { status: 'missing', url: '' });
    const title = walkTitle(verification);
    const built = `Scene built by Builder from revision ${revision ?? prep.scene.group.userData.revision ?? 0}: unfinished L0 shell with approximate dimensions.`;
    if (activeView === 'walk') return `${title}: ${verification.headline} Use WASD or arrow keys to move, Q and E to turn, drag to look around, and Esc to exit.`;
    const hint = activeView === 'top' ? 'Top view: scroll to zoom and drag to pan.' : 'Overview: drag to rotate, scroll to zoom, or select a room label to enter.';
    const walk = prep.walk.available ? ` ${title}: ${verification.headline}` : ` Walkthrough unavailable: ${prep.walk.reason}.`;
    return `${built} ${hint}${walk}`;
  }
  switch (mode) {
    case 'plan':
      return 'Source floor plan with the model overlay. The 3D scene has not been built yet.';
    case 'plan-only':
      return 'Source floor plan without an overlay because the model scale is unknown. The 3D scene has not been built yet.';
    case 'scheme':
      return 'The source floor plan is unavailable; showing the model wall layout. The 3D scene has not been built yet.';
    default:
      return 'The source floor plan is unavailable and the model has no geometry. The 3D scene has not been built yet.';
  }
}

export function renderWalkHud(verification?: WalkVerification): string {
  const keysRow = (items: [string, string, string][]) => items.map(([code, glyph, label]) => `<button type="button" data-key="${code}" aria-label="${escapeHtml(label)}">${glyph}</button>`).join('');
  const status = verification ?? walkVerification({ status: 'missing', url: '' });
  return `<div class="walk-banner">
      <span class="live-dot${status.level === 'ready' ? '' : ' is-trial'}" aria-hidden="true"></span>
      <span class="hud-room" id="hud-room">Outside rooms</span>
      <span class="hud-area" id="hud-area"></span>
      <span class="hud-verification" id="hud-verification" title="${escapeHtml(status.headline)}">${escapeHtml(status.headline)}</span>
      <button type="button" class="hud-button" data-action="lock-mouse" title="Esc releases the mouse">${icon('eye')}Mouse look</button>
      <button type="button" class="hud-button" data-action="walk-exit">${icon('close')}Exit</button>
    </div>
    <div class="crosshair" aria-hidden="true"></div>
    <p class="walk-keys">Use WASD or arrow keys to move, Q and E to turn, and Shift to move faster. Drag to look around.</p>
    <div class="touch-controls" aria-label="Movement controls">
      ${keysRow([['KeyQ', '↶', 'Turn left'], ['KeyW', '↑', 'Move forward'], ['KeyE', '↷', 'Turn right']])}
      ${keysRow([['KeyA', '←', 'Move left'], ['KeyS', '↓', 'Move back'], ['KeyD', '→', 'Move right']])}
    </div>`;
}

export function renderLightbox(): string {
  return `<button type="button" class="icon-button lightbox-close" data-action="lightbox-close" aria-label="Close">${icon('close')}</button>
    <button type="button" class="icon-button lightbox-nav lightbox-prev" data-action="lightbox-prev" aria-label="Previous photo">${icon('left')}</button>
    <figure class="lightbox-figure">
      <img id="lightbox-image" alt="" />
      <figcaption id="lightbox-caption"></figcaption>
    </figure>
    <button type="button" class="icon-button lightbox-nav lightbox-next" data-action="lightbox-next" aria-label="Next photo">${icon('right')}</button>`;
}
