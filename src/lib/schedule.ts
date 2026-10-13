import { getDocumentProxy } from 'unpdf';

const SCHEDULE_PDF_URL = 'https://members-assets.iracing.com/public/schedulepdf/SeasonSchedule.pdf';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TITLE_COLUMN_MAX_X = 100;
const TRACK_COLUMN_MIN_X = 143;
const TRACK_COLUMN_MAX_X = 300;
const LENGTH_COLUMN_MIN_X = 500;

const WEEK_PATTERN = /^Week (\d+) \((\d{4}-\d{2}-\d{2})\)/;
const RACE_TIME_PATTERN = /^\(\d{4}-\d{2}-\d{2} /;
const TOC_LEADER_PATTERN = /\.\s\./;
const SERIES_TITLE_PATTERN = /\d{4} Season/;
const SEASON_LABEL_PATTERN = /\d{4} Season \d+/;

interface PdfItem {
  text: string;
  x: number;
  y: number;
}

interface SeriesWeek {
  week: number;
  start: number;
  track: string;
  length: string;
}

export interface SeriesSchedule {
  name: string;
  weeks: SeriesWeek[];
}

export interface WeeklyEntry {
  name: string;
  series: string;
  week: number;
  start: number;
  track: string;
  length: string;
}

export interface WeeklySchedule {
  season: string;
  week: number;
  start: number;
  entries: WeeklyEntry[];
}

export function displayName(name: string): string {
  return name
    .replace(/\s*-?\s*\d{4} Season(?: \d+)?/g, '')
    .replace(/\s+by .+?(?=\s+-\s|$)/, '')
    .trim();
}

function formatLength(text: string): string {
  if (/^\d+$/.test(text)) return `${text} min`;
  return /^\d+ (mins?|laps?)$/.test(text) ? text.replace('mins', 'min') : '';
}

async function fetchPdfPages(): Promise<PdfItem[][]> {
  const response = await fetch(SCHEDULE_PDF_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Schedule PDF fetch failed with status ${response.status}`);
  }

  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  const pages: PdfItem[][] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const { items } = await (await pdf.getPage(number)).getTextContent();
    pages.push(
      items.flatMap((item) =>
        'str' in item && item.str.trim() ? [{ text: item.str.trim(), x: item.transform[4] as number, y: item.transform[5] as number }] : [],
      ),
    );
  }
  return pages;
}

export function parseSchedule(pages: PdfItem[][]): SeriesSchedule[] {
  const all: SeriesSchedule[] = [];
  let current: SeriesSchedule | undefined;

  for (const page of pages) {
    const items = page.filter((item) => !TOC_LEADER_PATTERN.test(item.text)).sort((a, b) => b.y - a.y || a.x - b.x);

    for (const [index, item] of items.entries()) {
      if (item.x < TITLE_COLUMN_MAX_X && SERIES_TITLE_PATTERN.test(item.text) && !WEEK_PATTERN.test(item.text)) {
        current = { name: item.text, weeks: [] };
        all.push(current);
        continue;
      }

      const week = item.text.match(WEEK_PATTERN);
      if (!week || !current) continue;

      const track: string[] = [];
      let length = '';
      for (const next of items.slice(index + 1)) {
        if (RACE_TIME_PATTERN.test(next.text) || WEEK_PATTERN.test(next.text)) break;
        if (next.x >= TRACK_COLUMN_MIN_X && next.x < TRACK_COLUMN_MAX_X) track.push(next.text);
        if (next.x >= LENGTH_COLUMN_MIN_X && Math.abs(next.y - item.y) < 2) length = formatLength(next.text);
      }
      current.weeks.push({ week: Number(week[1]), start: Date.parse(`${week[2]}T00:00:00Z`), track: track.join(' '), length });
    }
  }

  return all.filter((series) => series.weeks.length > 0);
}

export function buildWeeklySchedule(all: SeriesSchedule[], names: string[], now: Date): WeeklySchedule | undefined {
  const entries: WeeklyEntry[] = [];

  for (const series of all) {
    if (!names.includes(series.name)) continue;

    const current = series.weeks.find((entry) => entry.start <= now.getTime() && now.getTime() < entry.start + WEEK_MS);
    if (!current?.track) continue;

    entries.push({ name: series.name, series: displayName(series.name), ...current });
  }

  if (entries.length === 0) return undefined;

  const season = all.map((series) => series.name.match(SEASON_LABEL_PATTERN)?.[0]).find(Boolean) ?? '';
  return { season, week: entries[0].week, start: entries[0].start, entries };
}

export async function loadSchedule(): Promise<SeriesSchedule[]> {
  return parseSchedule(await fetchPdfPages());
}

export function formatWeekRange(start: number): string {
  const format = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${format(start)} – ${format(start + WEEK_MS - 24 * 60 * 60 * 1000)}`;
}
