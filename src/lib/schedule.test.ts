import { describe, expect, it } from 'vitest';
import { buildWeeklySchedule, displayName, formatWeekRange, parseSchedule, type SeriesSchedule } from './schedule.js';

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

function series(name: string, category: string, weeks: [number, string, string][], extra: Partial<SeriesSchedule> = {}): SeriesSchedule {
  return {
    name,
    category,
    weeklyCars: false,
    cars: '',
    races: '',
    team: false,
    weeks: weeks.map(([week, date, track]) => ({ week, start: utc(date), track, cars: '' })),
    ...extra,
  };
}

const mazda = series('Global Mazda MX-5 Cup - 2026 Season 4', 'Sports Car', [
  [8, '2026-11-03', 'Lime Rock Park'],
  [9, '2026-11-10', 'Sebring International Raceway'],
]);

const tour = series(
  'Global Endurance Tour - 2026 Season 4',
  'Sports Car',
  [
    [4, '2026-11-07', 'Autodromo Hermanos Rodriguez'],
    [5, '2026-11-21', 'Silverstone Circuit'],
  ],
  { cars: 'Porsche 963 GTP, Ferrari 296 GT3', team: true, races: 'Races every other Saturday at 7, 18 GMT and Sunday at 14 GMT' },
);

const all = [mazda, tour];
const names = all.map((entry) => entry.name);

describe('displayName', () => {
  it('drops the season, sponsor and trailing markers', () => {
    expect(displayName('Global Mazda MX-5 Cup by Fanatec - 2026 Season 4')).toBe('Global Mazda MX-5 Cup');
    expect(displayName('GT3 Regional Tour by SensitHaptics - Europe - 2026 Season 4')).toBe('GT3 Regional Tour - Europe');
  });
});

describe('formatWeekRange', () => {
  it('shows Tuesday through Monday', () => {
    expect(formatWeekRange(utc('2026-11-03'))).toBe('Nov 3 – Nov 9');
  });
});

describe('buildWeeklySchedule', () => {
  it('returns nothing when no tracked series is racing', () => {
    expect(buildWeeklySchedule(all, ['Unknown'], new Date('2026-11-04T12:00:00Z'))).toBeUndefined();
  });

  it('moves endurance series into their own category after Sports Car', () => {
    const schedule = buildWeeklySchedule(all, names, new Date('2026-11-04T12:00:00Z'));
    expect(schedule?.entries.map((entry) => [entry.series, entry.category])).toEqual([
      ['Global Mazda MX-5 Cup', 'Sports Car'],
      ['Global Endurance Tour', 'Endurance'],
    ]);
  });

  it('uses the Tuesday week start and the regular series week number', () => {
    const schedule = buildWeeklySchedule(all, names, new Date('2026-11-04T12:00:00Z'));
    expect(schedule?.start).toBe(utc('2026-11-03'));
    expect(schedule?.week).toBe(8);
  });

  it('keeps an event dated on the weekend in that week through Monday night', () => {
    const saturday = buildWeeklySchedule(all, names, new Date('2026-11-07T12:00:00Z'));
    const monday = buildWeeklySchedule(all, names, new Date('2026-11-09T23:00:00Z'));
    expect(saturday?.entries.map((entry) => entry.series)).toContain('Global Endurance Tour');
    expect(monday?.entries.map((entry) => entry.series)).toContain('Global Endurance Tour');
  });

  it('leaves endurance out of weeks with no event', () => {
    const schedule = buildWeeklySchedule(all, names, new Date('2026-11-10T12:00:00Z'));
    expect(schedule?.entries.map((entry) => entry.series)).toEqual(['Global Mazda MX-5 Cup']);
    expect(schedule?.week).toBe(9);
  });

  it('falls back to the event when only an endurance series races', () => {
    const schedule = buildWeeklySchedule(all, names, new Date('2026-11-18T12:00:00Z'));
    expect(schedule?.entries.map((entry) => entry.series)).toEqual(['Global Endurance Tour']);
    expect(schedule?.start).toBe(utc('2026-11-17'));
    expect(schedule?.week).toBe(5);
  });

  it('gives endurance entries their header cars and race times', () => {
    const entry = buildWeeklySchedule(all, names, new Date('2026-11-04T12:00:00Z'))?.entries.find((item) => item.category === 'Endurance');
    expect(entry?.cars).toBe('Porsche 963 GTP, Ferrari 296 GT3');
    expect(entry?.races).toContain('Saturday at 7, 18 GMT');
  });

  it('marks team racing on endurance entries only', () => {
    const entries = buildWeeklySchedule(all, names, new Date('2026-11-04T12:00:00Z'))?.entries;
    expect(entries?.find((item) => item.category === 'Endurance')?.team).toBe(true);
    expect(entries?.find((item) => item.category === 'Sports Car')?.team).toBeUndefined();
  });

  it('trusts the weekly driver limits over the header', () => {
    const solo = series('Solo Endurance - 2026 Season 4', 'Sports Car', [[8, '2026-11-03', 'Lime Rock Park']], { team: true });
    solo.weeks[0].drivers = { min: 1, max: 1 };
    const optional = series('Optional Endurance - 2026 Season 4', 'Sports Car', [[8, '2026-11-03', 'Lime Rock Park']], { team: false });
    optional.weeks[0].drivers = { min: 2, max: 16 };
    const entries = buildWeeklySchedule([solo, optional], [solo.name, optional.name], new Date('2026-11-04T12:00:00Z'))?.entries;
    expect(entries?.map((item) => [item.series, item.team, item.minDrivers])).toEqual([
      ['Solo Endurance', false, undefined],
      ['Optional Endurance', true, 2],
    ]);
  });

  it('only recategorizes Sports Car series', () => {
    const oval = series('Endurance Oval - 2026 Season 4', 'Oval', [[8, '2026-11-03', 'Daytona']]);
    const schedule = buildWeeklySchedule([oval], [oval.name], new Date('2026-11-04T12:00:00Z'));
    expect(schedule?.entries[0].category).toBe('Oval');
  });
});

describe('parseSchedule', () => {
  const item = (text: string, x: number, y: number) => ({ text, x, y });

  const page = [
    item('B Class Series (SPORTS CAR)', 56, 735),
    item('Global Endurance Tour - 2026 Season 4', 58, 709),
    item('Porsche 963 GTP, Ferrari 296 GT3, Mercedes-', 58, 695),
    item('AMG GT3 2020', 58, 681),
    item('Class C 4.0 --> Pro/WC 4.0, Team racing', 58, 667),
    item('Races every other Saturday at 7, 18 GMT and Sunday at 14 GMT', 58, 653),
    item('Week 1 (2026-09-26)', 58, 560),
    item('Indianapolis Motor Speedway - Road Course', 158, 560),
    item('Local enforced cautions, Min 2', 358, 560),
    item('360', 518, 560),
    item('(2026-09-26 09:15 1x)', 158, 551),
    item('drivers, Max 16 drivers, Drive Fair', 358, 551),
    item('Week 2 (2026-10-10)', 58, 511),
    item('Red Bull Ring - Grand Prix', 158, 511),
    item('(2026-10-10 09:10 1x)', 158, 502),
    item('Ring Meister by LVRY - 2026 Season 4', 58, 400),
    item('See race week for cars in use that week.', 58, 386),
    item('Week 1 (2026-09-15)', 58, 300),
    item('Nürburgring Nordschleife', 158, 300),
    item('Caterham 420R', 158, 291),
    item('(2026-09-19 13:45 1x)', 158, 282),
  ];

  const [tourSeries, ringMeister] = parseSchedule([page]);

  it('reads the series, category and weeks', () => {
    expect(tourSeries.name).toBe('Global Endurance Tour - 2026 Season 4');
    expect(tourSeries.category).toBe('Sports Car');
    expect(tourSeries.weeks.map((week) => [week.week, week.start, week.track])).toEqual([
      [1, utc('2026-09-26'), 'Indianapolis Motor Speedway - Road Course'],
      [2, utc('2026-10-10'), 'Red Bull Ring - Grand Prix'],
    ]);
  });

  it('collects the header car list and joins hyphenated line wraps', () => {
    expect(tourSeries.cars).toBe('Porsche 963 GTP, Ferrari 296 GT3, Mercedes-AMG GT3 2020');
  });

  it('flags team racing from the license line', () => {
    expect(tourSeries.team).toBe(true);
    expect(ringMeister.team).toBe(false);
    const solo = parseSchedule([
      [item('IMSA Sportscar Endurance Challenge - 2026 Season 4', 58, 700), item('Class D 4.0 --> Pro/WC 4.0', 58, 686), item('Week 1 (2026-09-19)', 58, 600), item('Silverstone Circuit', 158, 600)],
    ]);
    expect(solo[0].team).toBe(false);
  });

  it('reads driver limits from wrapped conditions text', () => {
    expect(tourSeries.weeks[0].drivers).toEqual({ min: 2, max: 16 });
    expect(tourSeries.weeks[1].drivers).toBeUndefined();
  });

  it('keeps the races line', () => {
    expect(tourSeries.races).toBe('Races every other Saturday at 7, 18 GMT and Sunday at 14 GMT');
  });

  it('splits the track from the cars for weekly-car series', () => {
    expect(ringMeister.weeklyCars).toBe(true);
    expect(ringMeister.weeks[0]).toMatchObject({ track: 'Nürburgring Nordschleife', cars: 'Caterham 420R' });
  });

  it('drops series that have no weeks', () => {
    expect(parseSchedule([[item('Empty Series - 2026 Season 4', 58, 700)]])).toEqual([]);
  });
});
