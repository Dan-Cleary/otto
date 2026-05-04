// Render every legal markdown file to a matching HTML file using the
// shared template at app/public/_brand/legal-template.html. Run as
// part of the build (see package.json `prebuild`).
//
//   md → html: heading levels, paragraphs, lists (- and 1.), inline
//   `code`, **bold**, [text](url). Deliberately tiny — these pages
//   don't need tables, blockquotes, or fenced blocks. If we ever do,
//   pull in `marked` instead.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const legalDir = join(repoRoot, "app/public/legal");
const templatePath = join(
  repoRoot,
  "app/public/_brand/legal-template.html",
);

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function inline(text) {
  // Order matters: links before bold so we don't escape ] inside [].
  let out = escapeHtml(text);
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, href) => `<a href="${href}">${label}</a>`,
  );
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let h1Found = false;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = inline(heading[2]);
      out.push(`<h${level}>${text}</h${level}>`);
      if (level === 1) h1Found = true;
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      out.push("<ul>");
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        out.push(`  <li>${inline(lines[i].replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push("</ul>");
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      out.push("<ol>");
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        out.push(`  <li>${inline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push("</ol>");
      continue;
    }

    // paragraph: read until blank line
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#/.test(lines[i]) && !/^[-*\d]/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return { html: out.join("\n"), h1Found };
}

async function main() {
  const template = await readFile(templatePath, "utf8");
  const entries = await readdir(legalDir);
  const mdFiles = entries.filter((f) => f.endsWith(".md"));
  for (const file of mdFiles) {
    const md = await readFile(join(legalDir, file), "utf8");
    const { html } = mdToHtml(md);
    const titleMatch = md.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : "legal";
    const rendered = template
      .replace("{{TITLE}}", title)
      .replace("{{BODY}}", html);
    const stem = basename(file, extname(file));
    const outPath = join(legalDir, `${stem}.html`);
    await writeFile(outPath, rendered);
    console.log(`rendered ${file} → ${stem}.html`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
