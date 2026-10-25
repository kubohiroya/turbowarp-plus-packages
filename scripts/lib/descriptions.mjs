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

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes inline links, emphasis and inline code, keeping the words. */
function stripInlineMarkup(line) {
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
export function stripSelfReference(text, names = []) {
  for (const name of names.filter(Boolean)) {
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
export function describeFromReadme(markdown, { names = [], minLength = 8 } = {}) {
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

  const text = stripSelfReference(paragraph.join(' ').replace(/\s+/g, ' ').trim(), names);
  return text.length >= minLength ? text : null;
}
