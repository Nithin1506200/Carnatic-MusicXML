import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluate } from "@mdx-js/mdx";
import { MDXProvider } from "@mdx-js/react";
import * as runtime from "react/jsx-runtime";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MusicScore } from "../components/score-notation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(root, "app", "generated-content.ts");
const legacyDownloadsDir = path.join(root, "public", "downloads");
const generatedScoresDir = path.join(root, "public", "generated-scores");
const webMscoreVendorDir = path.join(root, "public", "vendor", "webmscore");

const contentFiles = [
  "README.md",
  "AGENTS.md",
  "docs/01_training_and_sight_reading.md",
  "docs/02_basics_and_ragas.md",
  "docs/03_jatiswara.md",
  "docs/04_krithis.md",
  "docs/05_varnams.md",
  "docs/06_bhajans.md",
  "docs/carnatic_saxophone.md",
  "docs/score_metadata_template.md",
  "scores/README.md",
  "scores/02_basics/sarale_varase_to_alankaaras.mdx",
  "scores/02_basics/sri_gananatha_geethe.mdx",
  "scores/05_varnams/ninnu_kori_vasantha_varnam.mdx",
];

const categoryFor = (file) => {
  if (file === "README.md") return "Start here";
  if (file === "AGENTS.md" || file === "scores/README.md") return "Project";
  if (file.includes("score_metadata_template")) return "Reference";
  if (file.includes("carnatic_saxophone")) return "Reference";
  if (file.startsWith("scores/")) return "Scores";
  return "Learn";
};

const idFor = (file) => {
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

const allFiles = contentFiles.map((file, order) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const titleMatch = source.match(/^#\s+(.+)$/m);
  return {
    file,
    order,
    id: idFor(file),
    category: categoryFor(file),
    source,
    title: titleMatch?.[1]?.trim() ?? path.basename(file, ".md"),
  };
});

const sourceDirectivePattern = /^@\s*source(?:\s+file)?\s*:\s*(.+\.mscz)\s*$/im;

const museScoreSourceFor = (mdxFile, notation) => {
  const directive = notation.match(sourceDirectivePattern);
  if (!directive) return null;

  const requested = directive[1].trim().replace(/^["']|["']$/g, "");
  const absolute = path.resolve(root, path.dirname(mdxFile), requested);
  const scoresRoot = path.join(root, "scores");
  if (
    absolute !== scoresRoot &&
    !absolute.startsWith(`${scoresRoot}${path.sep}`)
  ) {
    throw new Error(
      `${mdxFile}: @source must reference a MuseScore file inside scores/.`,
    );
  }
  if (!fs.existsSync(absolute)) {
    throw new Error(`${mdxFile}: @source file does not exist: ${requested}`);
  }

  const repositoryPath = path.relative(root, absolute).replaceAll("\\", "/");
  return {
    repositoryPath,
    publicUrl: `/generated-scores/${repositoryPath.slice("scores/".length)}`,
  };
};

const carnaticBlocksFor = (source) =>
  [...source.matchAll(/```carnatic\r?\n([\s\S]*?)\r?\n```/g)].map(
    (match) => match[1],
  );

const museScoreSourcesFor = (file, source) => {
  if (!file.endsWith(".mdx") || !file.startsWith("scores/")) return [];
  return carnaticBlocksFor(source)
    .map((notation) => museScoreSourceFor(file, notation))
    .filter(Boolean);
};

const scoreSourceFor = (file, source) =>
  museScoreSourcesFor(file, source)[0]?.publicUrl ?? null;

const withoutSourceDirective = (notation) =>
  notation.replace(sourceDirectivePattern, "").replace(/^\s+/, "");

const idByAbsolutePath = new Map(
  allFiles.map((item) => [path.resolve(root, item.file), item.id]),
);

const rewriteHref = (sourceFile, href) => {
  if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith("#"))
    return href;
  const [target, anchor = ""] = href.split("#", 2);
  const resolved = path.resolve(root, path.dirname(sourceFile), target);
  if (/\.mdx?$/i.test(target) && idByAbsolutePath.has(resolved)) {
    const query = `?doc=${encodeURIComponent(idByAbsolutePath.get(resolved))}`;
    return anchor ? `${query}#${anchor}` : query;
  }
  return href;
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
    baseUrl: pathToFileURL(path.join(root, sourceFile)),
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

const stripTitleAndMetadata = (source) => {
  let body = source.replace(/^#\s+.+\n+/, "");
  const metadata = {};
  const yaml = body.match(/^```yaml\n([\s\S]*?)\n```\n*/);
  if (yaml) {
    for (const line of yaml[1].split("\n")) {
      const match = line.match(/^([a-z_]+):\s*(.+)$/);
      if (match) metadata[match[1]] = match[2];
    }
    body = body.slice(yaml[0].length);
  }
  return { body, metadata };
};

const documents = await Promise.all(
  allFiles.map(async (item) => {
    const { body, metadata } = stripTitleAndMetadata(item.source);
    const { html, headings } = item.file.endsWith(".mdx")
      ? await renderMdx(body, item.file)
      : renderMarkdown(body, item.file);
    const plainSource = item.file.endsWith(".mdx") ? html : body;
    const plain = plainSource
      .replace(/<[^>]+>/g, " ")
      .replace(/[`*_#|()[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const excerpt =
      plain.length > 170 ? `${plain.slice(0, 167).trim()}…` : plain;
    return {
      id: item.id,
      title: item.title,
      category: item.category,
      order: item.order,
      excerpt,
      html,
      searchText: `${item.title} ${plain}`.toLowerCase(),
      headings,
      metadata,
      sourcePath: item.file,
      scoreSource: scoreSourceFor(item.file, item.source),
    };
  }),
);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(
  outputFile,
  `// Generated by scripts/generate-content.mjs. Do not edit directly.\n` +
    `export const documents = ${JSON.stringify(documents, null, 2)} as const;\n`,
);

// MuseScore source files belong in the repository, not in the static website.
// Remove output made by older generator versions so stale downloads cannot ship.
fs.rmSync(legacyDownloadsDir, { recursive: true, force: true });

// Build-only assets: keep the MSCZ files authoritative in scores/ while making
// them available to the browser in the generated static output.
fs.rmSync(generatedScoresDir, { recursive: true, force: true });
const copiedScoreSources = new Set();
for (const item of allFiles) {
  for (const scoreSource of museScoreSourcesFor(item.file, item.source)) {
    if (copiedScoreSources.has(scoreSource.repositoryPath)) continue;
    copiedScoreSources.add(scoreSource.repositoryPath);
    const source = path.join(root, scoreSource.repositoryPath);
    const destination = path.join(root, "public", scoreSource.publicUrl);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

// Self-host webmscore so score rendering does not depend on a third-party CDN.
const webMscorePackageDir = path.join(root, "node_modules", "webmscore");
fs.rmSync(webMscoreVendorDir, { recursive: true, force: true });
fs.mkdirSync(webMscoreVendorDir, { recursive: true });
for (const filename of [
  "webmscore.lib.wasm",
  "webmscore.lib.mem.wasm",
  "webmscore.lib.data",
]) {
  fs.copyFileSync(
    path.join(webMscorePackageDir, filename),
    path.join(webMscoreVendorDir, filename),
  );
}
const browserRuntime = fs
  .readFileSync(path.join(webMscorePackageDir, "webmscore.cdn.mjs"), "utf8")
  .replace(
    /const CDN_PROVIDER = .*?\nconst URL_PREFIX = .*?\n/,
    "const URL_PREFIX = new URL('./', import.meta.url).href\n",
  )
  .replace(
    "export { WebMscoreW as default };",
    "globalThis.__webMscoreRuntime = WebMscoreW;\nexport { WebMscoreW as default };",
  );
fs.writeFileSync(
  path.join(webMscoreVendorDir, "webmscore.mjs"),
  browserRuntime,
);

// Use MuseScore 4's current engraving fonts when they are available locally.
// webmscore otherwise falls back to its older bundled font metrics.
const museScoreFontFiles = [
  "Edwin-Bold.otf",
  "Edwin-Italic.otf",
  "Edwin-Roman.otf",
  "Edwin-BdIta.otf",
  "Leland.otf",
  "LelandText.otf",
  "FreeSans.ttf",
];
const museScoreFontDirectories = [
  process.env.MUSESCORE_FONT_DIR,
  "/Applications/MuseScore 4.app/Contents/Resources/fonts",
  "/Applications/MuseScore4.app/Contents/Resources/fonts",
  path.resolve(
    root,
    "..",
    "..",
    "Desktop",
    "MuseScore 4.app",
    "Contents",
    "Resources",
    "fonts",
  ),
].filter(Boolean);
const museScoreFontDirectory = museScoreFontDirectories.find((directory) =>
  museScoreFontFiles.every((filename) =>
    fs.existsSync(path.join(directory, filename)),
  ),
);
if (!museScoreFontDirectory) {
  throw new Error(
    "MuseScore 4 fonts were not found. Set MUSESCORE_FONT_DIR to its Resources/fonts directory.",
  );
}
const embeddedFontPayloads = museScoreFontFiles.map((filename) =>
  fs
    .readFileSync(path.join(museScoreFontDirectory, filename))
    .toString("base64"),
);
fs.appendFileSync(
  path.join(webMscoreVendorDir, "webmscore.mjs"),
  `\nglobalThis.__webMscoreFonts = ${JSON.stringify(embeddedFontPayloads)}.map((encoded) => Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));\n`,
);

console.log(`Generated ${documents.length} documents.`);
