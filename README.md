# Markdown Studio Pro

A complete, responsive Markdown note-taking web application with **real-time live preview**, multiple notes, browser-based persistence, and one-click export to **Markdown (.md)** and **standalone HTML (.html)**.

Built with plain **HTML5, CSS3 and modern vanilla JavaScript (ES6+)** — no framework, no build step, no backend, no accounts.

---

## 1. Objective

Markdown Studio Pro is a distraction-free writing workspace: you type Markdown on the left, see the formatted result on the right, keep many notes in your browser, and download your work at any time. It was designed as a complete practical-examination project — the source is meant to be read, explained, and modified.

## 2. Features

- **Real-time rendering** — typing, pasting or deleting in the editor updates the preview immediately through a single `input` event listener.
- **Genuine split-screen editor** — a real `<textarea id="markdownInput">` beside a real `<div id="previewOutput">`, with independent scrolling.
- **Markdown support** — headings (all 6 levels), bold, italic, strikethrough, ordered/unordered/nested lists, task lists, inline code, fenced code blocks, blockquotes, horizontal rules, links, images, and tables (GitHub-Flavored Markdown via Marked.js).
- **Safe rendering** — every rendered fragment is sanitized with **DOMPurify**; scripts, event handlers and `javascript:` URLs are stripped. The HTML export uses the same sanitization.
- **Multiple notes** — create, select, rename, and delete (with confirmation). Each note has a stable UUID, title, raw Markdown, creation and modification timestamps.
- **localStorage persistence** — notes are stored under a versioned key (`markdownStudioProNotesV1`) with the active note id stored separately. Restored automatically on reload.
- **Autosave + manual save** — edits persist after a short debounce; the **Save note** button (Ctrl/Cmd+S) always forces an immediate save. The status chip distinguishes *Saved / Saving… / Unsaved changes / Storage error*.
- **Downloads** — Markdown export produces a valid `.md` file; HTML export produces a complete standalone HTML5 document with embedded styles.
- **Formatting toolbar** — heading, bold, italic, strikethrough, unordered/ordered list, blockquote, inline code, and link actions that wrap or prefix the current selection (with toggle-off support).
- **Keyboard shortcuts** — Ctrl/Cmd+S save, Ctrl/Cmd+B bold, Ctrl/Cmd+I italic.
- **Preview controls** — split view, editor-only, and preview-only layouts.
- **Light & dark themes** — follows your first-visit system preference, then remembers your explicit choice.
- **Word / character / line counts** in a compact status bar.
- **Accessible UI** — semantic HTML, keyboard-operable menus and dialogs, visible focus rings, `aria-live` status announcements, `prefers-reduced-motion` support.
- **Toast notifications and confirmation dialogs** for every destructive or notable action.

## 3. Technology stack

| Purpose | Technology |
|---|---|
| Structure | HTML5 (semantic elements, native `<dialog>`) |
| Styling | CSS3 (custom properties, grid/flexbox, media queries) |
| Logic | Vanilla JavaScript (ES6+) |
| Markdown parsing | [Marked.js](https://marked.js.org/) (vendored: `vendor/marked.min.js`) |
| HTML sanitization | [DOMPurify](https://github.com/cure53/DOMPurify) (vendored: `vendor/purify.min.js`) |
| Persistence | Browser `localStorage` |
| Downloads | Blob + URL APIs |
| Icons | Inline SVG sprite (lucide-style strokes) |
| Fonts | Google Fonts: Plus Jakarta Sans (UI), JetBrains Mono (editor), Lora (preview) — graceful fallbacks when offline |

There are **no npm dependencies required to run the app** — both libraries are vendored locally.

## 4. Project structure

```
markdown-studio-pro/
├── index.html        # Semantic page structure: navbar, sidebar, toolbar, panes, status bar, dialogs
├── style.css         # Design tokens, layout, editor/preview styling, themes, responsive rules
├── script.js         # All application logic (rendering, persistence, notes, exports, shortcuts)
├── README.md         # This file
├── package.json      # Optional manifest with a local static-server script
└── vendor/
    ├── marked.min.js   # Marked.js v15 (Markdown → HTML parser)
    └── purify.min.js   # DOMPurify v3 (HTML sanitizer)
```

## 5. Setup

No installation is needed. Clone or copy the `markdown-studio-pro` folder — that's it.

## 6. Running locally

Any of these works:

1. **Just open it** — double-click `index.html`. Because the scripts are plain (non-module) files and both libraries are vendored, the app runs from the file system. (Google Fonts degrade to fallback fonts offline.)
2. **Node static server** (recommended):
   ```bash
   npm exec --yes serve .     # or: npx serve .
   # then open http://localhost:3000
   ```
   or with the provided package.json:
   ```bash
   npm run start
   ```
3. **Python static server**:
   ```bash
   python3 -m http.server 8000
   # then open http://localhost:8000
   ```

## 7. Markdown syntax examples

```markdown
# Heading 1
## Heading 2
###### Heading 6

**bold text**  __also bold__  *italic text*  _also italic_  ~~strikethrough~~

- Unordered item
- Another item
  - Nested item

1. First step
2. Second step

`inline code`

```js
// fenced code block
function greet(name) {
  return `Hello, ${name}!`;
}
```

> A blockquote with wisdom inside.

---

[An open-source parser](https://marked.js.org/)

![Alt text](https://example.com/image.png)

| Column A | Column B |
|----------|----------|
| one      | two      |
```

## 8. How the event listeners work

The heart of the app is one line:

```js
markdownInput.addEventListener("input", updatePreview);
```

The `input` event fires for **every** way the textarea's value can change — typing, pasting, cutting, drag-and-drop and autocomplete — which is why it is used instead of `keyup` (which misses paste/mouse edits) or `change` (which only fires on blur). `updatePreview()` runs the full pipeline: render the preview, refresh counters, flag unsaved changes, and schedule the debounced autosave. Toolbar actions and the sample/clear features dispatch a synthetic `input` event so they reuse the exact same path.

## 9. How the DOM manipulation works

- `document.getElementById` collects references once at startup.
- The preview is updated with `previewOutput.innerHTML = sanitizeHTML(...)`. `innerHTML` is only ever given HTML that has passed through DOMPurify; **all other** dynamic text (note titles, toasts, counts, dialogs) is inserted with `textContent`/`createTextNode`, which cannot execute HTML.
- The sidebar list is rebuilt with `document.createElement` — user-authored note titles are never injected as markup.
- The empty state is built with `replaceChildren()` so no stale nodes linger.

## 10. How Markdown parsing and sanitization work

`renderMarkdown()` calls `marked.parse(markdown, { gfm: true, breaks: false })`, producing an HTML string. That string is immediately passed to `DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["style"] })`, which:

- removes `<script>` and other dangerous elements,
- strips `on*` event-handler attributes,
- neutralizes unsafe URL schemes such as `javascript:` in links and images.

The same two functions are used for the live preview **and** the standalone HTML export, so what you see is exactly what you export.

## 11. localStorage and autosave

- `markdownStudioProNotesV1` — a JSON array of notes: `{ id, title, content, createdAt, updatedAt }`.
- `markdownStudioProActiveV1` — the id of the currently selected note (stored separately).
- `markdownStudioProThemeV1` / `markdownStudioProLayoutV1` — UI preferences.

Every write is wrapped in `try/catch`. If storage is unavailable (private mode, blocked) or the quota is exceeded, the status chip switches to **Storage error** and a toast explains the problem — the app never claims "Saved" after a failed write. On startup the collection is parsed defensively: malformed JSON or invalid entries are discarded gracefully rather than crashing. Autosave runs ~0.9 s after the last keystroke; switching notes and leaving the page flush the pending save first, so **unsaved changes are never silently dropped**.

> ⚠️ localStorage lives in **this browser, on this machine, for this origin only**. It is not a cloud sync — clearing browser data deletes the notes. Use the export features for anything you want to keep.

## 12. How the Blob-based downloads work

1. The raw Markdown (or the built standalone HTML string) is placed in a `new Blob([...], { type: "text/markdown;charset=utf-8" })`.
2. `URL.createObjectURL(blob)` creates a temporary `blob:` URL.
3. A temporary `<a download="filename.md">` anchor is clicked programmatically, then removed.
4. `URL.revokeObjectURL(url)` releases the URL shortly after.

Filenames are derived from the note title with `sanitizeFilename()` (illegal characters removed, spaces → hyphens, 60-char cap, `untitled-note` fallback).

## 13. Testing instructions

Manual checklist (all verified — see §15):

- Type `# Hello`, then a paragraph — preview updates on every keystroke.
- Paste multi-paragraph Markdown — preview updates without touching a key.
- All six heading levels; `**bold**`, `*italic*`, `~~strike~~`; lists (mixed/nested); inline and fenced code; blockquotes; links; tables.
- Select a word and click **Bold** / press Ctrl+B — toggles on, again toggles off.
- Create, rename (click the navbar title), switch and delete notes; reload the page — everything is restored.
- Confirm dialogs appear for delete/clear; cancel preserves content.
- Export Markdown → open the `.md` file; export HTML → open the `.html` file standalone (works offline, contains only the note).
- Toggle split / editor-only / preview-only; reload — layout is remembered.
- Toggle the theme; reload — theme is remembered.
- Resize below ~880px — panels stack vertically, sidebar becomes an overlay.

## 14. Core JavaScript concepts demonstrated

Event delegation, the `input` event, closures and module-level state, `Promise`-based confirm dialogs, `setTimeout` debouncing, `JSON.parse`/`stringify` with defensive validation, Blob/Object URLs, `crypto.randomUUID`, `<dialog>.showModal()`, data-attribute-driven layout switching, `matchMedia`, and DOM building with `createElement`/`textContent`.

## 15. Known limitations

- Storage is per-browser/per-origin — no cross-device or cloud sync.
- The ~0.9 s autosave debounce means a hard browser crash within that window can lose the last few keystrokes (manual save is always available).
- Fenced code blocks are not syntax-highlighted (plain monospace).
- The "Download source code (.zip)" entry points at the archive shipped alongside the hosted app; when running from a bare local folder it may 404 — the project files themselves are always present in the folder.
- Google Fonts require a network connection; offline the app falls back to system fonts.

---

Built as a complete, examination-ready demonstration of real-time Markdown rendering, safe DOM manipulation, and browser persistence.
