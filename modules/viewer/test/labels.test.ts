import { describe, expect, it } from 'vitest';
import { basisLabel, provenanceLabel, roomTypeLabel, siteLabel, formatArea, formatMeters, formatPercent, formatDate } from '../src/labels';

describe('labels', () => {
  it('names room types in plain Russian', () => {
    expect(roomTypeLabel('bedroom')).toBe('спальня');
    expect(roomTypeLabel('wc')).toBe('санузел');
    expect(roomTypeLabel('unknown')).toBe('тип не определён');
  });

  it('explains where a value comes from', () => {
    expect(basisLabel('declared')).toBe('по объявлению');
    expect(basisLabel('inferred')).toBe('выведено из плана');
    expect(basisLabel('assumed')).toBe('принято по умолчанию');
    expect(basisLabel('declared-area')).toBe('подобран по заявленной площади');
  });

  it('turns provenance strings into words and keeps unknown ones verbatim', () => {
    expect(provenanceLabel('fixture/manual@0.1')).toBe('ручная разметка эталона');
    expect(provenanceLabel('plan-parser/opencv@0.1')).toBe('распознавание плана (OpenCV)');
    expect(provenanceLabel('human')).toBe('правка человека');
    expect(provenanceLabel('something-else@2')).toBe('something-else@2');
  });

  it('names known sites', () => {
    expect(siteLabel('cityexpert')).toBe('CityExpert');
    expect(siteLabel('manual')).toBe('ручная загрузка');
    expect(siteLabel('other')).toBe('other');
  });

  it('formats numbers the Russian way', () => {
    expect(formatArea(105)).toBe('105 м²');
    expect(formatMeters(2.8)).toBe('2,8 м');
    expect(formatPercent(0.7)).toBe('70 %');
    expect(formatDate('2026-09-12T11:49:06.375Z')).toBe('12 сентября 2026');
  });
});
