import { describe, expect, it } from 'vitest';
import type { WeeklyEntry, WeeklySchedule } from './schedule.js';
import { formatCars, formatRaceTimes, formatThisWeek } from './weekly.js';

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

describe('formatCars', () => {
  it('shortens to the shared class', () => {
    expect(formatCars('Mercedes-AMG GT3 2020, Ferrari 296 GT3')).toBe('GT3');
  });

  it('groups a multiclass list by class', () => {
    expect(formatCars('Porsche 963 GTP, Ferrari 499P, Dallara P217, Ford Mustang GT3, BMW M4 GT3 EVO')).toBe('GTP, LMH, P217, GT3');
  });

  it('keeps full names for cars with no known class', () => {
    expect(formatCars('BMW M2 Racing (G87), Toyota GR86, Renault Clio')).toBe('BMW M2 Racing (G87), Toyota GR86, Renault Clio');
  });

  it('keeps unclassified cars next to the classes', () => {
    expect(formatCars('Mercedes-AMG GT3 2020, Ferrari 296 GT3, Porsche 911 Cup (992.2), BMW M4 GT4')).toBe('GT3, Porsche 911 Cup (992.2), GT4');
  });

  it('keeps full names when grouping would not shorten the list', () => {
    expect(formatCars('Porsche 963 GTP, Ferrari 296 GT3')).toBe('Porsche 963 GTP, Ferrari 296 GT3');
  });

  it('returns a single car as is', () => {
    expect(formatCars('Lotus 79')).toBe('Lotus 79');
  });

  it('truncates a long list of unrelated cars', () => {
    const cars = Array.from({ length: 10 }, (_, index) => `${'a'.repeat(index + 20)} ${'b'.repeat(index + 20)}`).join(', ');
    expect(formatCars(cars)).toMatch(/ \+\d+ more$/);
  });
});

describe('formatRaceTimes', () => {
  it('converts GMT to Mountain standard time', () => {
    expect(formatRaceTimes('Races every other Saturday at 7, 18 GMT and Sunday at 14 GMT', utc('2026-11-07'))).toBe('Sat 12am, 11am · Sun 7am MT');
  });

  it('uses daylight time for events before the clocks change', () => {
    expect(formatRaceTimes('Races every other Saturday at 7, 18 GMT and Sunday at 14 GMT', utc('2026-09-26'))).toBe('Sat 1am, 12pm · Sun 8am MT');
  });

  it('puts early GMT hours on the previous Mountain day', () => {
    expect(formatRaceTimes('Races on Saturday at 7 & 17:00 GMT & Sunday at 0 & 13 GMT', utc('2026-11-07'))).toBe('Sat 12am, 10am, 5pm · Sun 6am MT');
  });

  it('handles events that start on a Friday', () => {
    expect(formatRaceTimes('Races Friday at 19 GMT, Saturday at 7 GMT, Sunday at 18 GMT', utc('2026-09-25'))).toBe('Fri 1pm · Sat 1am · Sun 12pm MT');
  });

  it('handles plural days and "and"', () => {
    expect(formatRaceTimes('Races Saturdays 9 and 19 GMT and Sundays 17 GMT', utc('2026-11-07'))).toBe('Sat 2am, 12pm · Sun 10am MT');
  });

  it('keeps minutes', () => {
    expect(formatRaceTimes('Races Saturday at 7:30 GMT', utc('2026-11-07'))).toBe('Sat 12:30am MT');
  });

  it('returns nothing when there are no days', () => {
    expect(formatRaceTimes('Races on every hour on the hour', utc('2026-11-07'))).toBe('');
  });
});

function entry(series: string, category: string, extra: Partial<WeeklyEntry> = {}): WeeklyEntry {
  return { name: series, category, series, week: 8, start: utc('2026-11-03'), track: 'Lime Rock Park', cars: '', races: '', ...extra };
}

describe('formatThisWeek', () => {
  const schedule = (entries: WeeklyEntry[]): WeeklySchedule => ({ season: '2026 Season 4', week: 8, start: utc('2026-11-03'), entries });

  it('prints the header and one heading per category', () => {
    const text = formatThisWeek(schedule([entry('Mazda', 'Sports Car'), entry('BMW', 'Sports Car'), entry('Tour', 'Endurance')]));
    expect(text.startsWith('# 2026 Season 4 Week 8\n## Nov 3 – Nov 9')).toBe(true);
    expect(text.match(/### Sports Car/g)).toHaveLength(1);
    expect(text).toContain('### Endurance');
  });

  it('shows cars in bold italic and race times as subtext', () => {
    const text = formatThisWeek(
      schedule([entry('Tour', 'Endurance', { start: utc('2026-11-07'), cars: 'Mercedes-AMG GT3 2020, Ferrari 296 GT3', races: 'Races Saturday at 7 GMT' })]),
    );
    expect(text).toContain('**Tour**: Lime Rock Park · ***GT3***\n-# Sat 12am MT');
  });

  it('stays under the Discord message limit', () => {
    const many = Array.from({ length: 80 }, (_, index) => entry(`Series number ${index}`, 'Sports Car', { track: 'A fairly long track name here' }));
    expect(formatThisWeek(schedule(many)).length).toBeLessThanOrEqual(2000);
  });
});
