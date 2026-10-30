import { parseCsvObjects } from './csv';

export interface HistoryEntry {
  letterboxdUri: string | null;
  name: string;
  year: number | null;
  rating: number | null;
  ratedAt: string | null;
  liked: boolean;
  inWatchlist: boolean;
  diaryViews: number;
  rewatchViews: number;
  hasLoggedRewatch: boolean;
  firstWatched: string | null;
  lastWatched: string | null;
}

export interface ParseReport {
  files: Record<string, number>;
  ignored: string[];
  entries: number;
  rated: number;
  withDiary: number;
  withRewatch: number;
  watchlist: number;
  diaryStart: string | null;
  warnings: string[];
}

/**
 * Files we deliberately never read.  `lists/gammon.csv` is a joke list.
 * `deleted/` and `orphaned/` hold diary entries and reviews you deleted (or
 * whose film is gone), so they must not count as viewings.
 */
const IGNORED = [/(^|\/)lists\//i, /gammon/i, /comments\.csv$/i, /(^|\/)(deleted|orphaned)\//i];

export function isIgnored(path: string): boolean {
  return IGNORED.some((re) => re.test(path));
}

function num(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function date(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Stable identity for a title across the export's files: name + year.
 *
 * Not the "Letterboxd URI": in watched.csv and ratings.csv that is the film's
 * link, but in diary.csv and reviews.csv it is the link to that diary entry or
 * review, so keying on it splits every diary row off from its film and the
 * rewatch evidence never reaches the rating.  `uri` is kept in the signature
 * for callers; it no longer decides identity.
 */
export function keyOf(name: string, year: number | null, _uri?: string | null): string {
  return `${name.trim().toLowerCase()}::${year ?? ''}`;
}

/**
 * Fold every CSV in the export into one row per title.
 *
 * `files` maps the path inside the ZIP (e.g. "diary.csv", "likes/films.csv")
 * to its text content.  Unknown files are skipped rather than failing.
 */
export function parseExport(files: Record<string, string>): {
  entries: HistoryEntry[];
  report: ParseReport;
} {
  const byKey = new Map<string, HistoryEntry>();
  const report: ParseReport = {
    files: {},
    ignored: [],
    entries: 0,
    rated: 0,
    withDiary: 0,
    withRewatch: 0,
    watchlist: 0,
    diaryStart: null,
    warnings: [],
  };

  const get = (name: string, year: number | null, uri: string | null): HistoryEntry => {
    const k = keyOf(name, year, uri);
    let e = byKey.get(k);
    if (!e) {
      e = {
        letterboxdUri: uri,
        name,
        year,
        rating: null,
        ratedAt: null,
        liked: false,
        inWatchlist: false,
        diaryViews: 0,
        rewatchViews: 0,
        hasLoggedRewatch: false,
        firstWatched: null,
        lastWatched: null,
      };
      byKey.set(k, e);
    }
    if (!e.year && year) e.year = year;
    if (!e.letterboxdUri && uri) e.letterboxdUri = uri;
    return e;
  };

  const pick = (want: RegExp): [string, string][] =>
    Object.entries(files).filter(([p]) => {
      if (isIgnored(p)) {
        if (!report.ignored.includes(p)) report.ignored.push(p);
        return false;
      }
      return want.test(p);
    });

  const rowsOf = (path: string, text: string) => {
    const rows = parseCsvObjects(text);
    report.files[path] = rows.length;
    return rows;
  };

  // ---- watched.csv: the widest net, establishes the row set -------------
  for (const [p, text] of pick(/(^|\/)watched\.csv$/i)) {
    for (const r of rowsOf(p, text)) {
      if (!r.Name) continue;
      get(r.Name, num(r.Year), r['Letterboxd URI'] || null);
    }
  }

  // ---- ratings.csv ------------------------------------------------------
  for (const [p, text] of pick(/(^|\/)ratings\.csv$/i)) {
    for (const r of rowsOf(p, text)) {
      if (!r.Name) continue;
      const e = get(r.Name, num(r.Year), r['Letterboxd URI'] || null);
      const rating = num(r.Rating);
      if (rating !== null) {
        e.rating = rating;
        e.ratedAt = date(r.Date);
      }
    }
  }

  // ---- diary.csv: the only source of rewatch evidence -------------------
  for (const [p, text] of pick(/(^|\/)diary\.csv$/i)) {
    for (const r of rowsOf(p, text)) {
      if (!r.Name) continue;
      const e = get(r.Name, num(r.Year), r['Letterboxd URI'] || null);
      e.diaryViews += 1;
      // Letterboxd writes "Yes" here; any non-empty value counts.
      if ((r.Rewatch ?? '').trim() !== '') e.rewatchViews += 1;
      const watched = date(r['Watched Date']) ?? date(r.Date);
      if (watched) {
        if (!e.firstWatched || watched < e.firstWatched) e.firstWatched = watched;
        if (!e.lastWatched || watched > e.lastWatched) e.lastWatched = watched;
        if (!report.diaryStart || watched < report.diaryStart) report.diaryStart = watched;
      }
      if (e.rating === null) {
        const rating = num(r.Rating);
        if (rating !== null) e.rating = rating;
      }
    }
  }

  // ---- likes/films.csv --------------------------------------------------
  for (const [p, text] of pick(/likes\/films\.csv$/i)) {
    for (const r of rowsOf(p, text)) {
      if (!r.Name) continue;
      get(r.Name, num(r.Year), r['Letterboxd URI'] || null).liked = true;
    }
  }

  // ---- watchlist.csv ----------------------------------------------------
  for (const [p, text] of pick(/(^|\/)watchlist\.csv$/i)) {
    for (const r of rowsOf(p, text)) {
      if (!r.Name) continue;
      get(r.Name, num(r.Year), r['Letterboxd URI'] || null).inWatchlist = true;
    }
  }

  // ---- reviews.csv: another rewatch witness ----------------------------
  for (const [p, text] of pick(/(^|\/)reviews\.csv$/i)) {
    for (const r of rowsOf(p, text)) {
      if (!r.Name) continue;
      const e = get(r.Name, num(r.Year), r['Letterboxd URI'] || null);
      if ((r.Rewatch ?? '').trim() !== '') e.rewatchViews += 1;
    }
  }

  // Two logged viewings of the same film is a rewatch whether or not the
  // flag was ticked, so count that too.
  for (const e of byKey.values()) {
    e.hasLoggedRewatch = e.rewatchViews > 0 || e.diaryViews > 1;
  }

  const entries = [...byKey.values()];
  report.entries = entries.length;
  report.rated = entries.filter((e) => e.rating !== null).length;
  report.withDiary = entries.filter((e) => e.diaryViews > 0).length;
  report.withRewatch = entries.filter((e) => e.hasLoggedRewatch).length;
  report.watchlist = entries.filter((e) => e.inWatchlist).length;

  if (!report.files['ratings.csv'] && !Object.keys(report.files).some((f) => /ratings\.csv$/.test(f)))
    report.warnings.push('No ratings.csv found — Model A has no target to fit.');
  if (!Object.keys(report.files).some((f) => /diary\.csv$/.test(f)))
    report.warnings.push('No diary.csv found — Model B has no rewatch evidence.');
  if (report.diaryStart)
    report.warnings.push(
      `Diary begins ${report.diaryStart}. Rewatch counts before that date are missing entirely, ` +
        'so a rewatch count is a floor, never a measurement.',
    );

  return { entries, report };
}
