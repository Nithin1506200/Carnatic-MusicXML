import React, { Children, cloneElement, isValidElement } from "react";
import { useMDXComponents } from "@mdx-js/react";

const isUpperOctave = (token) => /[\u0307]$/.test(token);
const isLowerOctave = (token) => /[\u0323]$/.test(token);
const isDivider = (token) => token === "|" || token === "||";

const parseNotation = (value) => {
  if (Array.isArray(value)) {
    return {
      tokens: value,
      solidBefore: [],
      doubleBefore: [],
      doubleEnd: false,
    };
  }

  if (typeof value !== "string") {
    throw new TypeError("Notation must be an array or a grouped string.");
  }

  const sourceTokens = value.trim().split(/\s+/).filter(Boolean);
  const tokens = [];
  const solidBefore = [];
  const doubleBefore = [];
  let doubleEnd = false;

  sourceTokens.forEach((token, index) => {
    if (!isDivider(token)) {
      tokens.push(token);
      return;
    }

    const isEnd = index === sourceTokens.length - 1;
    if (token === "||" && isEnd) {
      doubleEnd = true;
    } else if (token === "||") {
      doubleBefore.push(tokens.length);
    } else {
      solidBefore.push(tokens.length);
    }
  });

  return { tokens, solidBefore, doubleBefore, doubleEnd };
};

const sameNumbers = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const sectionKey = (title) => {
  const words = title
    .replace(/^\d+\.\s*/, "")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0
        ? lower
        : `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
};

const cleanTextLine = (line) =>
  line
    .trim()
    .replace(/^["'`]\s*/, "")
    .replace(/\s*["'`]\s*,?\s*$/, "")
    .trim();

const validateAlignedLyrics = (swaras, lyrics) => {
  if (!lyrics) return;
  if (swaras.tokens.length !== lyrics.tokens.length) {
    throw new Error(
      `Swara and lyric lines must have the same number of cells (${swaras.tokens.length} !== ${lyrics.tokens.length}).`,
    );
  }
  if (
    !sameNumbers(swaras.solidBefore, lyrics.solidBefore) ||
    !sameNumbers(swaras.doubleBefore, lyrics.doubleBefore) ||
    swaras.doubleEnd !== lyrics.doubleEnd
  ) {
    throw new Error(
      "Swara and lyric lines must use tala dividers in the same positions.",
    );
  }
};

const parseNotationSource = (source) => {
  if (typeof source !== "string") {
    throw new TypeError("Notation text must be a string.");
  }

  const sections = [];
  const keys = new Set();
  let current = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = cleanTextLine(rawLine);
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s*(.+)$/);
    if (heading) {
      const swarasOnly = /\s*\[swaras\]\s*$/i.test(heading[1]);
      const title = heading[1].replace(/\s*\[swaras\]\s*$/i, "").trim();
      const key = sectionKey(title);
      if (!key) throw new Error(`Notation section has no usable name: ${line}`);
      if (keys.has(key)) throw new Error(`Duplicate notation section: ${title}`);
      current = {
        key,
        title,
        swarasOnly,
        rows: [],
        before: [],
        after: [],
      };
      keys.add(key);
      sections.push(current);
      continue;
    }

    if (!current) {
      throw new Error(`Notation line appears before a section heading: ${line}`);
    }
    if (line.startsWith("@") || line.startsWith(">")) {
      const direction = line.replace(/^[@>]\s*/, "");
      const position = current.rows.length === 0 ? "before" : "after";
      current[position].push(direction);
      continue;
    }
    current.rows.push(line.replace(/\s+/g, " "));
  }

  for (const section of sections) {
    const { title, swarasOnly, rows } = section;
    if (rows.length === 0) {
      throw new Error(`Notation section is empty: ${title}`);
    }
    if (swarasOnly) {
      rows.forEach((row) => parseNotation(row));
      section.content = rows;
      continue;
    }
    if (rows.length % 2 !== 0) {
      throw new Error(
        `${title} must contain alternating swara and lyric lines; found ${rows.length} lines.`,
      );
    }
    section.content = [];
    for (let index = 0; index < rows.length; index += 2) {
      const swaras = rows[index];
      const lyrics = rows[index + 1];
      validateAlignedLyrics(parseNotation(swaras), parseNotation(lyrics));
      section.content.push({ swaras, lyrics });
    }
  }

  return sections;
};

export function parseNotationText(source) {
  const result = {};
  for (const section of parseNotationSource(source)) {
    result[section.key] = section.content;
  }
  return result;
}

const SwaraToken = ({ token }) => {
  if (isUpperOctave(token)) return React.createElement("strong", null, token);
  if (isLowerOctave(token)) return React.createElement("em", null, token);
  return token;
};

const cellClassName = (index, solidBefore, doubleBefore, doubleEnd, length) =>
  [
    "swara-cell",
    solidBefore.includes(index) ? "tala-solid-before" : "",
    doubleBefore.includes(index) ? "tala-double-before" : "",
    doubleEnd && index === length - 1 ? "tala-double-end" : "",
  ]
    .filter(Boolean)
    .join(" ");

const NotationRow = ({
  tokens,
  kind = "swara",
  number,
  rowSpan,
  solidBefore,
  doubleBefore,
  doubleEnd,
}) =>
  React.createElement(
    "tr",
    { className: kind === "lyrics" ? "swara-lyrics" : "swara-notes" },
    number
      ? React.createElement(
          "td",
          {
            className: "swara-row-number",
            rowSpan,
            "aria-hidden": true,
          },
          React.createElement("span", null, number),
        )
      : null,
    tokens.map((token, index) =>
      React.createElement(
        "td",
        {
          className: cellClassName(
            index,
            solidBefore,
            doubleBefore,
            doubleEnd,
            tokens.length,
          ),
          key: index,
        },
        kind === "swara"
          ? React.createElement(SwaraToken, { token })
          : token,
      ),
    ),
  );

const PalmLeafTable = ({ children }) =>
  React.createElement(
    "div",
    { className: "palm-leaf-frame" },
    React.createElement(
      "table",
      { className: "swara-notation-table" },
      children,
    ),
  );

export function SwaraTable({
  swaras,
  lyrics,
  number,
  solidBefore,
  doubleBefore,
  doubleEnd,
}) {
  const parsedSwaras = parseNotation(swaras);
  const parsedLyrics = lyrics ? parseNotation(lyrics) : null;
  validateAlignedLyrics(parsedSwaras, parsedLyrics);
  const resolvedSolidBefore = solidBefore ?? parsedSwaras.solidBefore;
  const resolvedDoubleBefore = doubleBefore ?? parsedSwaras.doubleBefore;
  const resolvedDoubleEnd = doubleEnd ?? parsedSwaras.doubleEnd;

  return React.createElement(
    PalmLeafTable,
    null,
    React.createElement(
      "tbody",
      null,
      React.createElement(NotationRow, {
        tokens: parsedSwaras.tokens,
        number,
        rowSpan: lyrics ? 2 : 1,
        solidBefore: resolvedSolidBefore,
        doubleBefore: resolvedDoubleBefore,
        doubleEnd: resolvedDoubleEnd,
      }),
      parsedLyrics
        ? React.createElement(NotationRow, {
            tokens: parsedLyrics.tokens,
            kind: "lyrics",
            solidBefore: resolvedSolidBefore,
            doubleBefore: resolvedDoubleBefore,
            doubleEnd: resolvedDoubleEnd,
          })
        : null,
    ),
  );
}

export function SwaraGrid({
  rows,
  solidBefore,
  doubleBefore,
  doubleEnd,
}) {
  return React.createElement(
    PalmLeafTable,
    null,
    React.createElement(
      "tbody",
      null,
      rows.map((row, index) => {
        const parsed = parseNotation(row);
        return React.createElement(NotationRow, {
          tokens: parsed.tokens,
          number: index + 1,
          solidBefore: solidBefore ?? parsed.solidBefore,
          doubleBefore: doubleBefore ?? parsed.doubleBefore,
          doubleEnd: doubleEnd ?? parsed.doubleEnd,
          key: index,
        });
      }),
    ),
  );
}

export function SwaraLines({ lines }) {
  return React.createElement(
    React.Fragment,
    null,
    lines.map((line, index) =>
      React.createElement(SwaraTable, {
        ...line,
        number: index + 1,
        key: index,
      }),
    ),
  );
}

const headingId = (title) =>
  title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");

const Direction = ({ children }) => {
  const match = children.match(/^(?:\*\*)?([^:*]+):(?:\*\*)?\s*(.*)$/);
  if (!match) {
    return React.createElement("p", { className: "music-direction" }, children);
  }
  const kind = sectionKey(match[1]);
  return React.createElement(
    "p",
    { className: `music-direction music-direction-${kind}` },
    React.createElement("strong", null, `${match[1]}:`),
    match[2] ? ` ${match[2]}` : "",
  );
};

const NotationEyeIcon = () =>
  React.createElement(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": true },
    React.createElement("path", {
      d: "M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z",
    }),
    React.createElement("circle", { cx: 12, cy: 12, r: 2.75 }),
  );

export function MusicScore({ source }) {
  const sections = parseNotationSource(source);
  const { h3: MdxHeading } = useMDXComponents();
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      {
        type: "button",
        className: "notation-overview-trigger",
        "data-notation-overview": true,
        "aria-label": "Open notation view",
        title: "Open notation view",
      },
      React.createElement(NotationEyeIcon),
    ),
    sections.map((section) => {
      const id = headingId(section.title);
      return React.createElement(
        MusicSection,
        {
          title: section.title,
          notationKind: section.swarasOnly ? "swaras" : "lyrics",
          key: section.key,
        },
        MdxHeading
          ? React.createElement(MdxHeading, null, section.title)
          : React.createElement(
              "h3",
              { id },
              section.title,
              React.createElement(
                "a",
                {
                  className: "heading-anchor",
                  href: `#${id}`,
                  "aria-label": `Link to ${section.title}`,
                },
                "#",
              ),
            ),
        section.before.map((direction, index) =>
          React.createElement(Direction, { key: `before-${index}` }, direction),
        ),
        section.swarasOnly
          ? React.createElement(SwaraGrid, { rows: section.content })
          : React.createElement(SwaraLines, { lines: section.content }),
        section.after.map((direction, index) =>
          React.createElement(Direction, { key: `after-${index}` }, direction),
        ),
      );
    }),
  );
}

export function MusicSection({ title, notationKind, children }) {
  let lineNumber = 0;
  const numberedChildren = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== SwaraTable) return child;
    lineNumber += 1;
    return cloneElement(child, { number: lineNumber });
  });

  return React.createElement(
    "div",
    {
      className: "music-section",
      "data-music-section": true,
      "data-title": title,
      "data-notation-kind": notationKind,
    },
    numberedChildren,
  );
}
