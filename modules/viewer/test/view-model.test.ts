import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { listingView } from '../src/view-model';
import { pluralize } from '../src/labels';

const dir = dirname(fileURLToPath(import.meta.url));
const synthetic = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8'));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
  return parsed.data;
}

describe('listingView', () => {
  it('exposes listing id, plan url and rooms from a validated model', () => {
    const view = listingView(model(synthetic), { kind: 'static' });
    expect(view.id).toBe('viewer-synthetic');
    expect(view.planUrl).toBe('/materials/plan.png');
    expect(view.rooms.map((room) => room.id)).toEqual(['r1', 'r2']);
    expect(view.rooms.map((room) => room.label)).toEqual(['Гостиная', 'Кухня']);
  });

  it('sorts rooms numerically so r10 follows r9', () => {
    const view = listingView(model(reference), { kind: 'fixture' });
    expect(view.rooms.map((room) => room.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10']);
  });

  it('builds a title from the declared area and a plain source description', () => {
    const view = listingView(model(reference), { kind: 'fixture' });
    expect(view.title).toBe('Квартира 105 м²');
    expect(view.source.siteLabel).toBe('CityExpert');
    expect(view.source.url).toContain('cityexpert.rs');
    expect(view.source.fetchedAtLabel).toBe('12 сентября 2026');
    expect(view.flat.areaDeclared).toBe(105);
    expect(view.flat.roomsDeclared).toBe(3.5);
    expect(view.flat.roomCount).toBe(10);
    expect(view.flat.photoCount).toBe(17);
  });

  it('collects photos per room from asset bindings and resolves their urls', () => {
    const view = listingView(model(reference), { kind: 'fixture' });
    const living = view.rooms.find((room) => room.id === 'r1');
    expect(living?.photoIds).toEqual(['p1', 'p2', 'p17']);
    expect(living?.typeLabel).toBe('жилая комната');
    expect(living?.confidence).toBe(0.9);
    expect(living?.basisLabel).toBe('выведено из плана');
    const first = view.photos[0];
    expect(first).toMatchObject({ id: 'p1', roomId: 'r1', roomLabel: 'Гостиная', faces: 'w7', url: '/fixtures/54541/photos/photo-01.jpg' });
    expect(first?.lookLabel).toBe('паркет, светлые стены');
    expect(view.photosBound).toBe(true);
    expect(view.photos.map((photo) => photo.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17']);
  });

  it('reports no bindings when no photo names a room', () => {
    const raw = structuredClone(reference);
    for (const asset of Object.values(raw.assets) as { kind: string; room?: string | null; faces?: string | null }[]) {
      if (asset.kind === 'photo') { asset.room = null; asset.faces = null; }
    }
    const view = listingView(model(raw), { kind: 'fixture' });
    expect(view.photosBound).toBe(false);
    expect(view.photos).toHaveLength(17);
    expect(view.rooms.every((room) => room.photoIds.length === 0)).toBe(true);
  });

  it('lists open questions with human subjects instead of ids', () => {
    const view = listingView(model(reference), { kind: 'fixture' });
    expect(view.questions).toHaveLength(6);
    const subjects = view.questions.map((question) => question.subject);
    expect(subjects).toContain('Помещение «Столовая и вход»');
    expect(subjects).toContain('Помещение «Коридор»');
    expect(subjects).toContain('Фото 11');
    expect(subjects.filter((subject) => subject.startsWith('Проём'))).toHaveLength(3);
    for (const question of view.questions) expect(question.subject).not.toMatch(/\b[rop]\d+\b/);
    expect(view.questions.find((question) => question.subject === 'Помещение «Коридор»')?.roomId).toBe('r6');
    expect(view.questions.find((question) => question.subject === 'Фото 11')?.photoId).toBe('p11');
  });

  it('describes scale and default heights with their basis', () => {
    const view = listingView(model(reference), { kind: 'fixture' });
    expect(view.plan).toMatchObject({ width: 940, height: 786, pxPerMeter: 66.123, basisLabel: 'подобран по заявленной площади', confidence: 0.7 });
    const ceiling = view.assumptions.find((item) => item.subject === 'Высота потолка');
    expect(ceiling).toMatchObject({ value: '2,8 м', basisLabel: 'принято по умолчанию' });
    expect(view.assumptions.map((item) => item.subject)).toEqual(['Высота потолка', 'Высота дверей', 'Подоконник', 'Высота окон']);
    expect(view.provenance).toEqual(['ручная разметка эталона']);
  });

  it('works on a rev 0 model without scale, geometry or photos', () => {
    const raw = structuredClone(synthetic);
    delete raw.plan.pxPerMeter;
    raw.walls = {};
    raw.vertices = {};
    const view = listingView(model(raw), { kind: 'static' });
    expect(view.plan.pxPerMeter).toBeUndefined();
    expect(view.photos).toEqual([]);
    expect(view.questions).toEqual([]);
    expect(view.title).toBe('Квартира 20 м²');
  });
});

describe('pluralize', () => {
  it('picks Russian plural forms', () => {
    const forms: [string, string, string] = ['фото', 'фото', 'фото'];
    expect(pluralize(1, ['комната', 'комнаты', 'комнат'])).toBe('комната');
    expect(pluralize(3, ['комната', 'комнаты', 'комнат'])).toBe('комнаты');
    expect(pluralize(11, ['комната', 'комнаты', 'комнат'])).toBe('комнат');
    expect(pluralize(22, ['комната', 'комнаты', 'комнат'])).toBe('комнаты');
    expect(pluralize(17, forms)).toBe('фото');
  });
});
