import { describe, expect, it } from 'vitest';
import { basisLabel, provenanceLabel, roomTypeLabel, siteLabel, formatArea, formatMeters, formatPercent, formatDate, pluralize } from '../src/labels';

describe('labels', () => {
  it('names room types in plain English', () => {
    expect(roomTypeLabel('bedroom')).toBe('bedroom');
    expect(roomTypeLabel('wc')).toBe('toilet');
    expect(roomTypeLabel('unknown')).toBe('room type unknown');
  });

  it('explains where a value comes from', () => {
    expect(basisLabel('declared')).toBe('from the listing');
    expect(basisLabel('inferred')).toBe('inferred from the floor plan');
    expect(basisLabel('assumed')).toBe('default assumption');
    expect(basisLabel('declared-area')).toBe('fitted to the listed area');
  });

  it('turns provenance strings into words and keeps unknown ones verbatim', () => {
    expect(provenanceLabel('fixture/manual@0.1')).toBe('manual reference markup');
    expect(provenanceLabel('plan-parser/opencv@0.1')).toBe('floor-plan recognition (OpenCV)');
    expect(provenanceLabel('human')).toBe('human change');
    expect(provenanceLabel('something-else@2')).toBe('something-else@2');
  });

  it('names known sites', () => {
    expect(siteLabel('cityexpert')).toBe('CityExpert');
    expect(siteLabel('manual')).toBe('manual upload');
    expect(siteLabel('other')).toBe('other');
  });

  it('formats numbers in English locale', () => {
    expect(formatArea(105)).toBe('105 m²');
    expect(formatMeters(2.8)).toBe('2.8 m');
    expect(formatPercent(0.7)).toBe('70 %');
    expect(formatDate('2026-09-12T11:49:06.375Z')).toBe('September 12, 2026');
  });
});

describe('pluralize', () => {
  it('uses the singular form only for one', () => {
    expect(pluralize(1, ['room', 'rooms', 'rooms'])).toBe('room');
    expect(pluralize(3, ['room', 'rooms', 'rooms'])).toBe('rooms');
    expect(pluralize(11, ['room', 'rooms', 'rooms'])).toBe('rooms');
    expect(pluralize(17, ['photo', 'photos', 'photos'])).toBe('photos');
  });
});
