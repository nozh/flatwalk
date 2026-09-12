import type { DataSource } from './source';
import type { ListingView, PhotoView } from './view-model';
import type { ReportResult } from './load-report';
import type { Overlay } from './plan-overlay';
import { countLabel, formatArea, formatMeters, formatPercent } from './labels';
import { escapeHtml, icon } from './html';

export type Selection = 'all' | string;

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

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
  return photo.roomLabel ? `Фото ${photo.number}, ${photo.roomLabel}` : `Фото ${photo.number}`;
}

function facesAttr(photo: PhotoView): string {
  return photo.faces ? ` data-faces="${escapeHtml(photo.faces)}"` : '';
}

/** Grid of photos; every thumbnail opens the lightbox. */
function renderThumbGrid(photos: PhotoView[]): string {
  return `<div class="thumbs is-grid">${photos.map((photo) => `
    <button type="button" class="thumb" data-photo="${escapeHtml(photo.id)}"${facesAttr(photo)} aria-label="Открыть ${escapeHtml(photoAlt(photo).toLowerCase())}">
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photoAlt(photo))}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" />
      <span class="thumb-number">${photo.number}</span>
    </button>`).join('')}</div>`;
}

export function galleryCaption(photo: PhotoView): string {
  const parts = [`Фото ${photo.number}`];
  if (photo.lookLabel) parts.push(photo.lookLabel);
  return parts.join(', ');
}

/** Hero photo with wraparound navigation and picker thumbnails (pattern from prototype/src/main.ts renderPhoto). */
export function renderGallery(photos: PhotoView[], index: number): string {
  const photo = photos[index];
  if (!photo) return '';
  const thumbs = photos.map((item, i) => `
    <button type="button" class="thumb is-picker" data-photo="${escapeHtml(item.id)}"${facesAttr(item)} aria-pressed="${i === index}" aria-label="Показать ${escapeHtml(photoAlt(item).toLowerCase())}">
      <img src="${escapeHtml(item.url)}" alt="" width="${item.width}" height="${item.height}" loading="lazy" decoding="async" />
    </button>`).join('');
  return `<button type="button" class="photo-main" data-photo="${escapeHtml(photo.id)}"${facesAttr(photo)} aria-label="Открыть ${escapeHtml(photoAlt(photo).toLowerCase())} крупно">
      <img id="gallery-image" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photoAlt(photo))}" width="${photo.width}" height="${photo.height}" decoding="async" />
      <span class="photo-zoom" aria-hidden="true">${icon('expand')}</span>
      <span class="photo-counter" id="gallery-counter">${index + 1} / ${photos.length}</span>
    </button>
    <div class="gallery-nav">
      <span class="gallery-caption" id="gallery-caption">${escapeHtml(galleryCaption(photo))}</span>
      <span class="gallery-buttons">
        <button type="button" class="icon-button" data-action="gallery-prev" aria-label="Предыдущее фото"${photos.length < 2 ? ' disabled' : ''}>${icon('left')}</button>
        <button type="button" class="icon-button" data-action="gallery-next" aria-label="Следующее фото"${photos.length < 2 ? ' disabled' : ''}>${icon('right')}</button>
      </span>
    </div>
    ${photos.length > 1 ? `<div class="thumbs is-picker-row">${thumbs}</div>` : ''}`;
}

export function renderRoomList(view: ListingView, selected: Selection): string {
  const all = `<button type="button" class="room-row is-all" data-select="all" aria-current="${selected === 'all'}">
      <span class="room-name">Вся квартира</span>
      <span class="room-count">${view.photos.length ? countLabel(view.photos.length, ['фото', 'фото', 'фото']) : 'без фото'}</span>
    </button>`;
  const rooms = view.rooms.map((room) => `<button type="button" class="room-row" data-select="${escapeHtml(room.id)}" aria-current="${selected === room.id}">
      <span class="room-name">${escapeHtml(room.label)}${room.question ? `<span class="room-question" title="${escapeHtml(room.question)}" aria-label="Есть открытый вопрос">${icon('question')}</span>` : ''}</span>
      <span class="room-count">${room.photoIds.length ? countLabel(room.photoIds.length, ['фото', 'фото', 'фото']) : ''}</span>
    </button>`).join('');
  return `<h2 class="sidebar-title">Помещения</h2>${all}${rooms || '<p class="panel-note">В модели нет помещений.</p>'}`;
}

function flatLead(view: ListingView): string {
  const declared: string[] = [];
  if (view.flat.areaDeclared !== undefined) declared.push(formatArea(view.flat.areaDeclared));
  if (view.flat.roomsDeclared !== undefined) declared.push(`${number.format(view.flat.roomsDeclared)} ${view.flat.roomsDeclared === 1 ? 'комната' : 'комнаты'}`);
  const first = declared.length ? `${declared.join(' и ')} по объявлению.` : 'Площадь и число комнат в объявлении не указаны.';
  const rooms = countLabel(view.flat.roomCount, ['помещение', 'помещения', 'помещений']);
  const photos = view.flat.photoCount
    ? `и ${countLabel(view.flat.photoCount, ['фотография', 'фотографии', 'фотографий'])}`
    : ', фотографий нет';
  return `${first} В модели ${rooms} ${photos}.`;
}

export function renderRoomPanel(view: ListingView, selected: Selection): string {
  if (selected === 'all') {
    const photos = view.photos.length
      ? `<h3 class="panel-section">Все фотографии</h3>${renderThumbGrid(view.photos)}`
      : `<p class="panel-note">В модели нет фотографий.</p>`;
    return `<header class="panel-head"><h2>Вся квартира</h2><p class="panel-lead">${escapeHtml(flatLead(view))}</p></header>${photos}`;
  }

  const room = view.rooms.find((item) => item.id === selected);
  if (!room) return `<p class="panel-note">Помещение не найдено.</p>`;
  const origin = [room.basisLabel.charAt(0).toUpperCase() + room.basisLabel.slice(1)];
  if (room.confidence !== undefined) origin.push(`уверенность ${formatPercent(room.confidence)}`);
  if (room.reviewed) origin.push('подтверждено человеком');

  let gallery: string;
  if (!view.photosBound) {
    gallery = `<p class="panel-note">Фотографии пока не привязаны к помещениям.</p><button type="button" class="link-button" data-select="all">Смотреть все фото</button>`;
  } else if (room.photoIds.length === 0) {
    gallery = `<p class="panel-note">К этому помещению фотографии не привязаны.</p>`;
  } else {
    const photos = photosFor(view, selected);
    gallery = `<h3 class="panel-section">${countLabel(photos.length, ['фотография', 'фотографии', 'фотографий'])}</h3><div class="gallery" id="gallery">${renderGallery(photos, 0)}</div>`;
  }

  return `<header class="panel-head">
      <h2>${escapeHtml(room.label)}</h2>
      <p class="panel-sub">${escapeHtml(room.typeLabel)}</p>
      <p class="panel-origin">${escapeHtml(origin.join(', '))}.</p>
      ${room.question ? `<p class="panel-question"><span class="panel-question-mark">${icon('question')}</span><span><b>Вопрос модели.</b> ${escapeHtml(room.question)}</span></p>` : ''}
    </header>${gallery}`;
}

function scaleSentence(view: ListingView): string {
  if (view.plan.pxPerMeter === undefined) return 'Масштаб плана не определён.';
  const parts = [`Масштаб плана ${view.plan.basisLabel}`];
  if (view.plan.confidence !== undefined) parts.push(`уверенность ${formatPercent(view.plan.confidence)}`);
  if (view.plan.reviewed) parts.push('подтверждён человеком');
  return `${parts.join(', ')}.`;
}

function ceilingSentence(view: ListingView): string {
  const ceiling = view.assumptions[0];
  if (!ceiling) return '';
  const value = formatMeters(view.flat.wallHeight);
  if (ceiling.basisLabel === 'принято по умолчанию') return `Высота потолка ${value} принята по умолчанию.`;
  return `Высота потолка ${value} (${ceiling.basisLabel}).`;
}

function verificationSentence(report: ReportResult): string {
  switch (report.status) {
    case 'ok':
      return report.report.walkReady ? 'Геометрия проверена, прогулка возможна.' : 'Геометрия проверена, прогулка пока не готова.';
    case 'stale':
      return 'Отчёт проверки устарел: геометрия не проверена.';
    case 'invalid':
      return 'Отчёт проверки повреждён: геометрия не проверена.';
    default:
      return 'Геометрия не проверена: отчёта Validator нет.';
  }
}

export function renderAssumptionStrip(view: ListingView, report: ReportResult): string {
  const sentences = [scaleSentence(view), ceilingSentence(view)];
  if (view.questions.length) sentences.push(`Открытых вопросов: ${view.questions.length}.`);
  sentences.push(verificationSentence(report));
  return `<p class="assumptions-text">${sentences.filter(Boolean).map(escapeHtml).join(' ')}</p>
    <button type="button" class="text-button" data-action="about">${icon('info')}Подробнее</button>`;
}

function reportSection(report: ReportResult): string {
  if (report.status === 'missing') {
    return `<p>Отчёт Validator для этой ревизии не найден. Геометрия, проходимость и масштаб не проверены; площади помещений не считались.</p>`;
  }
  if (report.status === 'stale') return `<p>Найден отчёт для другой модели или ревизии. Он устарел и не учитывается: геометрия не проверена.</p>`;
  if (report.status === 'invalid') return `<p>Файл отчёта не соответствует контракту и не учитывается: геометрия не проверена.</p>`;

  const { report: data } = report;
  const count = (status: string) => data.checks.filter((check) => check.status === status).length;
  const failed = data.checks.filter((check) => check.status === 'fail');
  const totals = [
    `${count('pass')} ${count('pass') === 1 ? 'пройдена' : 'пройдено'}`,
    `${count('fail')} не ${count('fail') === 1 ? 'пройдена' : 'пройдено'}`,
    `${count('unverified')} не ${count('unverified') === 1 ? 'проверена' : 'проверено'}`,
    `${count('skipped')} ${count('skipped') === 1 ? 'пропущена' : 'пропущено'}`,
  ];
  return `<p>Прогулка: геометрия ${data.walkReady ? 'готова' : 'не готова'}. Подтверждено ${formatPercent(data.confirmation)} проверок.</p>
    <p>Проверок ${data.checks.length}: ${escapeHtml(totals.join(', '))}.</p>
    ${failed.length ? `<ul class="about-checks">${failed.map((check) => `<li>${escapeHtml(check.message)}</li>`).join('')}</ul>` : ''}
    ${data.review.items.length ? `<p>На ревью ${countLabel(data.review.items.length, ['пункт', 'пункта', 'пунктов'])}:</p><ul class="about-review">${data.review.items.map((item) => `<li>${escapeHtml(item.reason)}${item.suggestion ? ` <span class="muted">${escapeHtml(item.suggestion)}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
}

export function renderAbout(view: ListingView, report: ReportResult, source: DataSource): string {
  const link = view.source.url
    ? ` <a href="${escapeHtml(view.source.url)}" target="_blank" rel="noopener noreferrer">Открыть объявление${icon('external')}</a>`
    : '';
  const mode = source.kind === 'fixture'
    ? 'Статический режим: показан эталон 54541 из бандла. Правки не сохраняются, Convex не подключён.'
    : 'Статический режим: модель прочитана из файла папки запуска. Правки не сохраняются, Convex не подключён.';
  const questions = view.questions.length
    ? `<ul class="about-questions">${view.questions.map((question) => `<li><b>${escapeHtml(question.subject)}.</b> ${escapeHtml(question.text)}</li>`).join('')}</ul>`
    : '<p>Открытых вопросов нет.</p>';

  return `<form method="dialog" class="dialog-head">
      <h2 id="about-title">О модели</h2>
      <button type="submit" class="icon-button" aria-label="Закрыть">${icon('close')}</button>
    </form>
    <div class="dialog-body">
      <section>
        <h3>Откуда данные</h3>
        <p>${escapeHtml(view.source.siteLabel)}, получено ${escapeHtml(view.source.fetchedAtLabel)}.${link}</p>
        <p>Разметка модели: ${escapeHtml(view.provenance.join(', ') || 'не указана')}.</p>
        <p class="muted">Модель ${escapeHtml(view.id)}, ревизия ${view.revision}.</p>
      </section>
      <section>
        <h3>Что принято без измерений</h3>
        <p>${escapeHtml(scaleSentence(view))}</p>
        <ul class="about-defaults">${view.assumptions.map((item) => `<li>${escapeHtml(item.subject)} ${escapeHtml(item.value)}, ${escapeHtml(item.basisLabel)}${item.reviewed ? ', подтверждено' : ''}.</li>`).join('')}</ul>
      </section>
      <section>
        <h3>Открытые вопросы${view.questions.length ? ` (${view.questions.length})` : ''}</h3>
        ${questions}
      </section>
      <section>
        <h3>Проверка</h3>
        ${reportSection(report)}
      </section>
      <section>
        <h3>Режим</h3>
        <p>${escapeHtml(mode)}</p>
      </section>
    </div>`;
}

export function renderStageStatus(activeView: 'plan' | 'scene', mode: Overlay['mode']): string {
  if (activeView === 'scene') return '3D-сцена ещё не построена: Builder не подключён, сцена пуста.';
  switch (mode) {
    case 'plan':
      return 'Исходный план с разметкой из модели. 3D-сцена ещё не построена.';
    case 'plan-only':
      return 'Исходный план без разметки: масштаб модели ещё не определён. 3D-сцена ещё не построена.';
    case 'scheme':
      return 'Исходный план недоступен, показана схема стен из модели. 3D-сцена ещё не построена.';
    default:
      return 'Исходный план недоступен, геометрии в модели нет. 3D-сцена ещё не построена.';
  }
}

export function renderLightbox(): string {
  return `<button type="button" class="icon-button lightbox-close" data-action="lightbox-close" aria-label="Закрыть">${icon('close')}</button>
    <button type="button" class="icon-button lightbox-nav lightbox-prev" data-action="lightbox-prev" aria-label="Предыдущее фото">${icon('prev')}</button>
    <figure class="lightbox-figure">
      <img id="lightbox-image" alt="" />
      <figcaption id="lightbox-caption"></figcaption>
    </figure>
    <button type="button" class="icon-button lightbox-nav lightbox-next" data-action="lightbox-next" aria-label="Следующее фото">${icon('next')}</button>`;
}
