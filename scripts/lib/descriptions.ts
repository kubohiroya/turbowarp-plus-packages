/**
 * Pulls a package's summary out of its README.
 *
 * The rule: the first paragraph under the opening heading is the summary,
 * written in that README's own language. So README.ja.md gives the Japanese
 * summary and README.md the English one.
 *
 * Neither GitHub's repository description nor npm's `description` can hold
 * more than one language, so the Japanese text has to come from somewhere
 * else. The READMEs already exist and are maintained alongside the code, which
 * makes them a better source than a copy kept here: fix the repository and the
 * dashboard follows on the next build.
 */

/**
 * Whether a summary is written in Japanese.
 *
 * Kana settles it: Japanese prose of any length contains some. A string of
 * bare kanji with no kana would not be caught, but no summary here looks like
 * that, and guessing wrong is worse than leaving the text where it is.
 */
export function looksJapanese(text: unknown) {
  return typeof text === 'string' && /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
}

/** Noise that sits between the heading and the summary. */
const BEFORE_PARAGRAPH = [
  /^!?\[!\[/, // badge rows
  /^<!--/,
  /^<\/?[a-z]/i, // raw HTML, <p align="center"> and friends
  /^[-*+]\s/, // bullets
  /^\d+\.\s/, // numbered lists
  /^>/, // callouts
  /^\|/, // tables
  /^```/,
  /^(-{3,}|={3,}|\*{3,})$/, // rules
  /^https?:\/\/\S+$/, // a bare link on its own line
];

/** "English | 日本語" language switchers, once the markup is stripped. */
const NAV_ONLY = /^(english|日本語|ja|en|[|·・\s])+$/i;

const HEADING = /^#{1,6}\s/;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Characters that do not take a space at a line break. A Markdown paragraph
 * wrapped across source lines joins with a space in English, but Japanese
 * wraps anywhere and a space there is a visible defect.
 */
const NO_SPACE_AT_WRAP =
  /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

/** Joins the lines of one paragraph the way each script expects. */
export function joinWrappedLines(lines: string[]) {
  return lines.reduce((joined, line) => {
    if (!joined) return line;
    const glue =
      NO_SPACE_AT_WRAP.test(joined.at(-1) ?? '') && NO_SPACE_AT_WRAP.test(line[0]) ? '' : ' ';
    return joined + glue + line;
  }, '');
}

/** Removes inline links, emphasis and inline code, keeping the words. */
function stripInlineMarkup(line: string) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> their text
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drops a leading "@scope/name は、". The package name is already the row
 * label, so repeating it costs a third of the cell and says nothing.
 *
 * Only the Japanese particle form is removed. English summaries read
 * "name provides X", where cutting the subject would leave a fragment.
 */
export function stripSelfReference(text: string, names: readonly (string | null)[] = []) {
  for (const name of names.filter((name): name is string => Boolean(name))) {
    const pattern = new RegExp(`^${escapeRegExp(name)}\\s*(?:は|とは)\\s*[、,]?\\s*`);
    if (pattern.test(text)) {
      const rest = text.replace(pattern, '').trim();
      // Only accept it when something substantial is left.
      if (rest.length >= 8) return rest;
    }
  }
  return text;
}

/**
 * The first paragraph under the opening heading, as one line.
 *
 * Returns null when that section holds no prose — a real answer, not a
 * failure: the caller then falls back to the other language.
 */
export function describeFromReadme(markdown: unknown, { names = [], minLength = 8 }: {
  names?: readonly (string | null)[];
  minLength?: number;
} = {}): string | null {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;

  const lines = markdown.split('\n');
  const headingAt = lines.findIndex((line) => HEADING.test(line.trim()));
  const paragraph = [];

  for (let i = headingAt + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // The next section begins: whatever we have is all there was.
    if (HEADING.test(line)) break;

    if (!line) {
      if (paragraph.length) break; // blank line ends the paragraph
      continue; // blank lines before it are nothing
    }

    if (!paragraph.length) {
      if (BEFORE_PARAGRAPH.some((pattern) => pattern.test(line))) continue;
      const clean = stripInlineMarkup(line);
      if (!clean || NAV_ONLY.test(clean)) continue;
      paragraph.push(clean);
      continue;
    }

    paragraph.push(stripInlineMarkup(line));
  }

  if (!paragraph.length) return null;

  const text = stripSelfReference(joinWrappedLines(paragraph).trim(), names);
  return text.length >= minLength ? text : null;
}
