import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluate } from "@mdx-js/mdx";
import { MDXProvider } from "@mdx-js/react";
import * as runtime from "react/jsx-runtime";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  MusicScore,
  NotationDirectiveKeyword,
  NotationParseError,
  parseNotationDirective,
  parseScoreNotation,
} from "../components/score-notation.ts";
import { getRaga } from "../components/ragas.generated.ts";

/**
 * Rendering library for the static site: turns one Markdown or MDX source
 * file into a document record (HTML, headings, metadata, excerpt). It is
 * pure per file — nothing here depends on the list of other documents — so
 * `scripts/generate-content.mjs` can cache records by source hash and render
 * cache misses in worker threads (`scripts/content-worker.mjs`).
 *
 * `CONTENT_SCORES_DIR` points the `scores/` tree at another directory (the
 * synthetic benchmark uses it); ids and URLs still read `scores/...`.
 */

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const scoresRoot = process.env.CONTENT_SCORES_DIR
  ? path.resolve(process.env.CONTENT_SCORES_DIR)
  : path.join(root, "scores");

/** Absolute path of a repository-relative content file, honoring the scores override. */
export const absolutePathFor = (file) =>
  file === "scores" || file.startsWith("scores/")
    ? path.join(scoresRoot, file.slice("scores".length + 1))
    : path.join(root, file);

/** Repository-relative content path for an absolute path, or null. */
export const relativePathFor = (absolute) => {
  const underScores = path.relative(scoresRoot, absolute);
  if (underScores && !underScores.startsWith("..") && !path.isAbsolute(underScores)) {
    return `scores/${underScores.replaceAll("\\", "/")}`;
  }
  const underRoot = path.relative(root, absolute);
  if (underRoot && !underRoot.startsWith("..") && !path.isAbsolute(underRoot)) {
    return underRoot.replaceAll("\\", "/");
  }
  return null;
};

/** Whether a repository-relative path is one of the site's documents. */
export const isContentFile = (file) =>
  file === "README.md" ||
  file === "AGENTS.md" ||
  file === "scores/README.md" ||
  (file.startsWith("docs/") && /\.mdx?$/i.test(file)) ||
  (file.startsWith("scores/") && file.endsWith(".mdx"));

const discoverFiles = (absoluteDirectory, prefix, extensions) => {
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs
    .readdirSync(absoluteDirectory, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && extensions.has(path.extname(entry.name)),
    )
    .map((entry) =>
      `${prefix}/${path
        .relative(absoluteDirectory, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/")}`,
    )
    .sort((left, right) => left.localeCompare(right));
};

/** Every content file, in site order. */
export const discoverContentFiles = () => [
  "README.md",
  ...discoverFiles(path.join(root, "docs"), "docs", new Set([".md", ".mdx"])),
  "scores/README.md",
  ...discoverFiles(scoresRoot, "scores", new Set([".mdx"])),
  "AGENTS.md",
];

export const categoryFor = (file) => {
  if (file === "README.md") return "Start here";
  if (file === "AGENTS.md" || file === "scores/README.md") return "Project";
  if (file.includes("score-notation")) return "Reference";
  if (file.includes("carnatic_saxophone")) return "Reference";
  if (file.startsWith("scores/")) return "Scores";
  return "Learn";
};

export const idFor = (file) => {
  if (file === "README.md") return "home";
  return file.replace(/\.mdx?$/i, "").replaceAll("\\", "/");
};

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const parseNotationForFile = (mdxFile, notation, blockLine = 1) => {
  try {
    return parseScoreNotation(notation);
  } catch (error) {
    const relativeLine = error instanceof NotationParseError ? error.line : 1;
    const column = error instanceof NotationParseError ? error.column : 1;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${mdxFile}:${blockLine + relativeLine - 1}:${column} - error Carnatic notation: ${message}`,
      { cause: error },
    );
  }
};

const museScoreSourceFor = (mdxFile, notation, blockLine = 1) => {
  const requested = parseNotationForFile(
    mdxFile,
    notation,
    blockLine,
  ).museScoreSource;
  if (!requested) return null;

  const absolute = path.resolve(
    path.dirname(absolutePathFor(mdxFile)),
    requested,
  );
  if (
    absolute !== scoresRoot &&
    !absolute.startsWith(`${scoresRoot}${path.sep}`)
  ) {
    throw new Error(
      `${mdxFile}:${blockLine}:1 - error Carnatic notation: @source must reference a MuseScore file inside scores/.`,
    );
  }
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `${mdxFile}:${blockLine}:1 - error Carnatic notation: @source file does not exist: ${requested}`,
    );
  }

  const repositoryPath = relativePathFor(absolute);
  return {
    repositoryPath,
    publicUrl: `/generated-scores/${repositoryPath.slice("scores/".length)}`,
  };
};

export const carnaticBlocksFor = (source) =>
  [...source.matchAll(/```carnatic\r?\n([\s\S]*?)\r?\n```/g)].map((match) => ({
    notation: match[1],
    line: source.slice(0, match.index).split(/\r?\n/).length + 1,
  }));

/** Every `@source` MuseScore file a score references, validated. */
export const museScoreSourcesFor = (file, source) => {
  if (!file.endsWith(".mdx") || !file.startsWith("scores/")) return [];
  return carnaticBlocksFor(source)
    .map(({ notation, line }) => museScoreSourceFor(file, notation, line))
    .filter(Boolean);
};

const withoutSourceDirective = (notation) =>
  notation
    .split(/\r?\n/)
    .filter(
      (line) =>
        parseNotationDirective(line)?.keyword !==
        NotationDirectiveKeyword.Source,
    )
    .join("\n")
    .replace(/^\s+/, "");

/**
 * Rewrites links between content files into `?doc=` app links. The target
 * is checked on disk rather than against a document list so a file's
 * rendering depends only on the filesystem.
 */
const rewriteHref = (sourceFile, href) => {
  if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith("#"))
    return href;
  const [target, anchor = ""] = href.split("#", 2);
  if (!/\.mdx?$/i.test(target)) return href;
  const resolved = path.resolve(
    path.dirname(absolutePathFor(sourceFile)),
    target,
  );
  const relative = relativePathFor(resolved);
  if (!relative || !isContentFile(relative) || !fs.existsSync(resolved)) {
    return href;
  }
  const query = `?doc=${encodeURIComponent(idFor(relative))}`;
  return anchor ? `${query}#${anchor}` : query;
};

const renderInline = (text, sourceFile) => {
  const code = [];
  let rendered = text.replace(/`([^`]+)`/g, (_, value) => {
    const key = `@@CODE${code.length}@@`;
    code.push(`<code>${escapeHtml(value)}</code>`);
    return key;
  });
  rendered = escapeHtml(rendered);
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = href.split("#", 1)[0];
    if (/\.mscz$/i.test(target)) {
      return `<span class="repository-only">${label} · repository only</span>`;
    }
    return `<a href="${escapeHtml(rewriteHref(sourceFile, href))}">${label}</a>`;
  });
  rendered = rendered
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  code.forEach((value, index) => {
    rendered = rendered.replace(`@@CODE${index}@@`, value);
  });
  return rendered;
};

const renderMarkdown = (markdown, sourceFile) => {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html = [];
  const headings = [];
  const seenSlugs = new Map();
  const numberSwaraTables = sourceFile.startsWith("scores/");
  let sectionLineNumber = 0;
  let index = 0;

  const headingSlug = (text) => {
    const base = slugify(text);
    const count = seenSlugs.get(base) ?? 0;
    seenSlugs.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(
        `<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(body.join("\n"))}</code></pre>`,
      );
      continue;
    }

    if (
      /^<div class="music-section" data-music-section data-title="[^"]+">$/.test(
        line.trim(),
      ) ||
      line.trim() === "</div>"
    ) {
      html.push(line.trim());
      index += 1;
      continue;
    }

    if (/^<table(?:\s|>)/.test(line.trim())) {
      const body = [line];
      index += 1;
      while (index < lines.length) {
        body.push(lines[index]);
        if (lines[index].includes("</table>")) {
          index += 1;
          break;
        }
        index += 1;
      }
      const tableHtml = body.join("\n");
      if (!numberSwaraTables) {
        html.push(tableHtml);
        continue;
      }

      const hasLyrics = tableHtml.includes("#B00020");
      if (hasLyrics) {
        sectionLineNumber += 1;
        const rowCount = (tableHtml.match(/<tr(?:\s|>)/g) ?? []).length;
        html.push(
          tableHtml.replace(
            /<tr([^>]*)>/,
            (row) =>
              `${row}<td class="swara-row-number swara-line-number" rowspan="${rowCount}" aria-hidden="true"><span>${sectionLineNumber}</span></td>`,
          ),
        );
        continue;
      }

      let rowNumber = 0;
      html.push(
        tableHtml.replace(/<tr([^>]*)>/g, (row) => {
          rowNumber += 1;
          return `${row}<td class="swara-row-number" aria-hidden="true"><span>${rowNumber}</span></td>`;
        }),
      );
      continue;
    }

    if (
      line.trim().startsWith("|") &&
      index + 1 < lines.length &&
      /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1])
    ) {
      const cellsFor = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());
      const headers = cellsFor(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(cellsFor(lines[index]));
        index += 1;
      }
      html.push(
        `<table class="content-table"><thead><tr>${headers
          .map((cell) => `<th>${renderInline(cell, sourceFile)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td>${renderInline(cell, sourceFile)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level >= 2 && level <= 4) sectionLineNumber = 0;
      const id = headingSlug(text);
      headings.push({ id, text, level });
      html.push(
        `<h${level} id="${id}">${renderInline(text, sourceFile)}<a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a></h${level}>`,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
        while (
          index < lines.length &&
          /^\s{2,}\S/.test(lines[index]) &&
          !/^[-*]\s+/.test(lines[index].trimStart())
        ) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
        }
      }
      html.push(
        `<ul>${items.map((item) => `<li>${renderInline(item, sourceFile)}</li>`).join("")}</ul>`,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      html.push(
        `<ol>${items.map((item) => `<li>${renderInline(item, sourceFile)}</li>`).join("")}</ol>`,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const body = [];
      while (index < lines.length && lines[index].startsWith("> ")) {
        body.push(lines[index].slice(2));
        index += 1;
      }
      html.push(
        `<blockquote>${body.map((item) => renderInline(item, sourceFile)).join("<br>")}</blockquote>`,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !lines[index].startsWith("```") &&
      !/^<table(?:\s|>)/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !lines[index].startsWith("> ")
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "), sourceFile)}</p>`);
  }

  return { html: html.join("\n"), headings };
};

const textFromChildren = (children) =>
  React.Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : React.isValidElement(child)
          ? textFromChildren(child.props.children)
          : "",
    )
    .join("");

const renderMdx = async (mdx, sourceFile) => {
  const headings = [];
  const seenSlugs = new Map();

  const headingSlug = (text) => {
    const base = slugify(text);
    const count = seenSlugs.get(base) ?? 0;
    seenSlugs.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  const headingComponent = (level) =>
    function Heading({ children }) {
      const text = textFromChildren(children);
      const id = headingSlug(text);
      headings.push({ id, text, level });
      return React.createElement(
        `h${level}`,
        { id },
        children,
        React.createElement(
          "a",
          {
            className: "heading-anchor",
            href: `#${id}`,
            "aria-label": `Link to ${text}`,
          },
          "#",
        ),
      );
    };

  const Link = ({ href = "", children }) => {
    const target = href.split("#", 1)[0];
    if (/\.mscz$/i.test(target)) {
      return React.createElement(
        "span",
        { className: "repository-only" },
        children,
        " · repository only",
      );
    }
    return React.createElement(
      "a",
      { href: rewriteHref(sourceFile, href) },
      children,
    );
  };

  const preparedMdx = mdx.replace(
    /```carnatic\r?\n([\s\S]*?)\r?\n```/g,
    (_, notation) => {
      const museScoreSource = museScoreSourceFor(sourceFile, notation);
      return `<MusicScore source={${JSON.stringify(withoutSourceDirective(notation))}} museScoreSource={${JSON.stringify(museScoreSource?.publicUrl ?? null)}} />`;
    },
  );
  const mdxModule = await evaluate(preparedMdx, {
    ...runtime,
    baseUrl: pathToFileURL(absolutePathFor(sourceFile)),
    useDynamicImport: true,
  });
  const components = {
    a: Link,
    MusicScore,
    h1: headingComponent(1),
    h2: headingComponent(2),
    h3: headingComponent(3),
    h4: headingComponent(4),
    h5: headingComponent(5),
    h6: headingComponent(6),
  };
  const html = renderToStaticMarkup(
    React.createElement(
      MDXProvider,
      { components },
      React.createElement(mdxModule.default, { components }),
    ),
  );
  return { html, headings };
};

/**
 * Score metadata declares only the raga name; the raga_type, janya_of,
 * melakarta_number, arohana, and avarohana shown in search and the app are
 * derived from data/ragas.toml (see scripts/generate-ragas.ts).
 */
const enrichRagaMetadata = (metadata) => {
  if (typeof metadata.raga !== "string" || !metadata.raga.trim()) {
    return metadata;
  }
  const raga = getRaga(metadata.raga.trim());
  if (!raga || raga.name === undefined) {
    return metadata;
  }
  return Object.fromEntries(
    Object.entries({
      ...metadata,
      raga_type: raga.type === "melakarta" ? "Melakarta" : "Janya raga",
      ...(raga.melakartaNumber !== undefined
        ? { melakarta_number: raga.melakartaNumber }
        : {}),
      ...(raga.janyaOf !== undefined
        ? { janya_of: `${raga.janyaOf} (Melakarta ${raga.janyaOfNumber})` }
        : {}),
      arohana: metadata.arohana_override ?? raga.arohana,
      avarohana: metadata.avarohana_override ?? raga.avarohana,
    }).filter(([, value]) => value !== undefined),
  );
};

const stripTitleAndMetadata = (source) => {
  let body = source.replace(/^#\s+.+\n+/, "");
  const metadata = {};
  const yaml = body.match(/^```yaml\n([\s\S]*?)\n```\n*/);
  if (yaml) {
    const parsed = parseYaml(yaml[1]);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Score metadata must be a YAML mapping.");
    }
    Object.assign(metadata, parsed);
    body = body.slice(yaml[0].length);
  }
  return { body, metadata: enrichRagaMetadata(metadata) };
};

/**
 * Renders one content file into a document record. The record carries
 * everything any output needs (page JSON, manifest, catalog, search index)
 * so it can be cached as a unit. `plainText` is kept only for non-score
 * documents, which are searched by body text.
 */
export const renderDocument = async (file, source = null) => {
  const text = source ?? fs.readFileSync(absolutePathFor(file), "utf8");
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? path.basename(file, ".md");
  const isMdx = file.endsWith(".mdx");
  const isScore = file.startsWith("scores/") && isMdx;
  const { body, metadata } = stripTitleAndMetadata(text);
  const { html, headings } = isMdx
    ? await renderMdx(body, file)
    : renderMarkdown(body, file);
  const plainSource = isMdx ? html : body;
  const plain = plainSource
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#|()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const excerpt =
    plain.length > 170 ? `${plain.slice(0, 167).trim()}…` : plain;
  const scoreSources = museScoreSourcesFor(file, text);
  return {
    id: idFor(file),
    title,
    category: categoryFor(file),
    excerpt,
    html,
    contentUrl: `/generated-content/${idFor(file)}.json`,
    headings,
    metadata,
    sourcePath: file,
    scoreSource: scoreSources[0]?.publicUrl ?? null,
    scoreSources,
    plainText: isScore ? "" : plain,
  };
};
