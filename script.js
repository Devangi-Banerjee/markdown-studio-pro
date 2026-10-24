"use strict";

/* global marked, DOMPurify */

/*
 * Markdown Studio Pro — script.js
 *
 * Rendering pipeline (the core requirement):
 *   textarea input → "input" event listener → marked.parse() → DOMPurify.sanitize()
 *   → preview DOM update → counts/status refresh → debounced autosave
 *
 * All user content is treated as untrusted: Markdown is parsed with Marked.js and the
 * resulting HTML is ALWAYS passed through DOMPurify before it touches the DOM.
 */

const STORAGE_KEYS = {
  notes: "markdownStudioProNotesV1",
  active: "markdownStudioProActiveV1",
  theme: "markdownStudioProThemeV1",
  layout: "markdownStudioProLayoutV1",
};

const AUTOSAVE_DELAY_MS = 900;
const DEFAULT_TITLE = "Untitled note";

const SAMPLE_CONTENT = [
  "# Welcome to Markdown Studio Pro",
  "",
  "Write **bold text**, *italic text*, and organized notes in Markdown.",
  "",
  "## My Learning Goals",
  "",
  "- Understand JavaScript events.",
  "- Practice DOM manipulation.",
  "- Build a complete web development project.",
  "",
  "## Important",
  "",
  "Remember to **save your work** regularly.",
  "",
  "> Good notes make learning easier.",
  "",
  "Example inline code: `console.log(\"Hello, Markdown!\");`",
  "",
  "## Try a Code Block",
  "",
  "```js",
  "function greet(name) {",
  "  return `Hello, ${name}!`;",
  "}",
  "```",
  "",
].join("\n");

/* ---------- Element references ---------- */
const markdownInput = document.getElementById("markdownInput");
const previewOutput = document.getElementById("previewOutput");
const byId = (id) => document.getElementById(id);

const els = {
  app: byId("app"),
  sidebar: byId("sidebar"),
  sidebarToggle: byId("sidebarToggle"),
  sidebarBackdrop: byId("sidebarBackdrop"),
  notesList: byId("notesList"),
  sidebarEmpty: byId("sidebarEmpty"),
  noteTitleButton: byId("noteTitleButton"),
  noteTitleText: byId("noteTitleText"),
  noteTitleInput: byId("noteTitleInput"),
  saveStatusChip: byId("saveStatusChip"),
  saveStatusText: byId("saveStatusText"),
  statusbarSaveState: byId("statusbarSaveState"),
  themeToggle: byId("themeToggle"),
  saveNoteButton: byId("saveNoteButton"),
  layoutSplit: byId("layoutSplit"),
  layoutEditor: byId("layoutEditor"),
  layoutPreview: byId("layoutPreview"),
  exportButton: byId("exportButton"),
  exportMenu: byId("exportMenu"),
  exportMarkdownItem: byId("exportMarkdownItem"),
  exportHtmlItem: byId("exportHtmlItem"),
  downloadZipItem: byId("downloadZipItem"),
  moreButton: byId("moreButton"),
  moreMenu: byId("moreMenu"),
  newNoteButton: byId("newNoteButton"),
  newNoteItem: byId("newNoteItem"),
  insertSampleItem: byId("insertSampleItem"),
  renameItem: byId("renameItem"),
  clearItem: byId("clearItem"),
  deleteItem: byId("deleteItem"),
  shortcutsItem: byId("shortcutsItem"),
  shortcutsDialog: byId("shortcutsDialog"),
  shortcutsCloseButton: byId("shortcutsCloseButton"),
  confirmDialog: byId("confirmDialog"),
  confirmTitle: byId("confirmTitle"),
  confirmMessage: byId("confirmMessage"),
  confirmOkButton: byId("confirmOkButton"),
  confirmCancelButton: byId("confirmCancelButton"),
  toastRegion: byId("toastRegion"),
  wordCount: byId("wordCount"),
  charCount: byId("charCount"),
  lineCount: byId("lineCount"),
  toolbarButtons: Array.from(document.querySelectorAll(".toolbar-button")),
};

/* ---------- Application state ---------- */
let notes = [];
let activeNoteId = null;
let autosaveTimer = null;
let hasUnsavedChanges = false;
let sidebarOpen = true;
let storageAvailable = true;
let confirmResolve = null;
let isRenaming = false;

const SAVE_STATES = {
  saved: { label: "Saved", cls: "is-saved" },
  saving: { label: "Saving…", cls: "is-saving" },
  unsaved: { label: "Unsaved changes", cls: "is-unsaved" },
  error: { label: "Storage error", cls: "is-error" },
};

/* ==========================================================================
   Initialization
   ========================================================================== */

function initializeApp() {
  storageAvailable = checkStorageAvailability();
  loadNotes();

  const storedActiveId = readActiveNoteId();
  const initialNote = notes.find((note) => note.id === storedActiveId) || notes[0];
  if (initialNote) {
    activeNoteId = initialNote.id;
  } else {
    const created = createNoteObject();
    notes.push(created);
    activeNoteId = created.id;
    persistNotes();
  }

  bindEvents();
  applyTheme(readTheme());
  applyLayout(readLayout());
  setSidebar(!isMobileLayout());
  hydrateFromActiveNote();
  renderNotesList();
  refreshView(storageAvailable ? "saved" : "error");

  if (!storageAvailable) {
    showNotification("Browser storage is unavailable — notes will not persist. Export your work regularly.", "error", 6000);
  }

  // Keep the relative "last modified" times in the sidebar fresh.
  setInterval(renderNotesList, 60000);
}

function bindEvents() {
  // The core real-time rendering listener. The "input" event captures typing,
  // pasting, cutting and drag-inserted text.
  markdownInput.addEventListener("input", updatePreview);

  els.saveNoteButton.addEventListener("click", saveNote);
  els.themeToggle.addEventListener("click", toggleTheme);

  [[els.layoutSplit, "split"], [els.layoutEditor, "editor"], [els.layoutPreview, "preview"]]
    .forEach(([button, mode]) => button.addEventListener("click", () => applyLayout(mode)));

  els.sidebarToggle.addEventListener("click", () => setSidebar(!sidebarOpen));
  els.sidebarBackdrop.addEventListener("click", () => setSidebar(false));

  els.newNoteButton.addEventListener("click", newNote);
  els.newNoteItem.addEventListener("click", () => { closeAllMenus(); newNote(); });

  els.toolbarButtons.forEach((button) =>
    button.addEventListener("click", () => applyFormatting(button.dataset.action))
  );

  setupDropdown(els.exportButton, els.exportMenu);
  setupDropdown(els.moreButton, els.moreMenu);

  els.exportMarkdownItem.addEventListener("click", () => { closeAllMenus(); downloadMarkdown(); });
  els.exportHtmlItem.addEventListener("click", () => { closeAllMenus(); downloadHTML(); });
  els.downloadZipItem.addEventListener("click", () => {
    closeAllMenus();
    showNotification("Source archive download started");
  });

  els.insertSampleItem.addEventListener("click", () => { closeAllMenus(); insertSample(); });
  els.renameItem.addEventListener("click", () => { closeAllMenus(); beginRename(); });
  els.clearItem.addEventListener("click", () => { closeAllMenus(); clearEditor(); });
  els.deleteItem.addEventListener("click", () => { closeAllMenus(); deleteNote(); });
  els.shortcutsItem.addEventListener("click", () => { closeAllMenus(); els.shortcutsDialog.showModal(); });
  els.shortcutsCloseButton.addEventListener("click", () => els.shortcutsDialog.close());

  // Rename via the navbar title
  els.noteTitleButton.addEventListener("click", beginRename);
  els.noteTitleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.noteTitleInput.blur(); // commits
    } else if (event.key === "Escape") {
      const note = currentNote();
      els.noteTitleInput.value = note ? note.title : DEFAULT_TITLE;
      els.noteTitleInput.blur(); // no change -> nothing persisted
    }
  });
  els.noteTitleInput.addEventListener("blur", commitRename);

  // Empty-state "Insert sample note" button (rendered inside the preview div)
  previewOutput.addEventListener("click", (event) => {
    if (event.target.closest("#insertSampleButton")) insertSample();
  });

  els.confirmDialog.addEventListener("close", () => {
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(els.confirmDialog.returnValue === "ok");
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".dropdown")) closeAllMenus();
  });
  document.addEventListener("keydown", handleShortcuts);
  window.addEventListener("beforeunload", flushAutosave);
  window.addEventListener("resize", () => setSidebar(sidebarOpen));
}

/* ==========================================================================
   Markdown rendering (parse → sanitize → DOM)
   ========================================================================== */

// Renders the preview, refreshes counters, flags unsaved changes and schedules autosave.
function updatePreview() {
  renderPreviewOutput();
  updateCounts();
  hasUnsavedChanges = true;
  updateSaveStatus("unsaved");
  scheduleAutosave();
}

function renderPreviewOutput() {
  const markdown = markdownInput.value;
  if (!markdown.trim()) {
    previewOutput.replaceChildren(buildEmptyState());
    return;
  }
  // Only sanitized HTML produced by renderMarkdown() is ever assigned here.
  previewOutput.innerHTML = renderMarkdown(markdown);
}

function renderMarkdown(markdown) {
  try {
    const parsed = marked.parse(markdown, { gfm: true, breaks: false });
    return sanitizeHTML(parsed);
  } catch (error) {
    console.error("Markdown parsing failed:", error);
    return "<p>Something went wrong while rendering this Markdown.</p>";
  }
}

function sanitizeHTML(html) {
  // DOMPurify strips <script>, event handlers and unsafe URL schemes (e.g. javascript:).
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form"],
    FORBID_ATTR: ["style"],
  });
}

function buildEmptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const message = document.createElement("p");
  message.textContent = "Your formatted note will appear here as you type.";
  const button = document.createElement("button");
  button.type = "button";
  button.id = "insertSampleButton";
  button.className = "secondary-button";
  button.dataset.testid = "insert-sample-button";
  button.textContent = "Insert sample note";
  wrap.append(message, button);
  return wrap;
}

/* ==========================================================================
   Word / character / line counts + save status
   ========================================================================== */

function updateCounts() {
  const text = markdownInput.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = text.length;
  const lines = text === "" ? 0 : text.split("\n").length;
  els.wordCount.textContent = `Words: ${words}`;
  els.charCount.textContent = `Characters: ${characters}`;
  els.lineCount.textContent = `Lines: ${lines}`;
}

function updateSaveStatus(state) {
  const config = SAVE_STATES[state] || SAVE_STATES.saved;
  els.saveStatusChip.className = `save-chip ${config.cls}`;
  els.saveStatusText.textContent = config.label;
  els.statusbarSaveState.textContent = config.label;
}

/* ==========================================================================
   localStorage persistence, autosave, manual save
   ========================================================================== */

function checkStorageAvailability() {
  try {
    const probe = "__markdownStudioProProbe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch (error) {
    return false;
  }
}

function loadNotes() {
  if (!storageAvailable) { notes = []; return; }
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEYS.notes);
  } catch (error) {
    storageAvailable = false;
    notes = [];
    return;
  }
  if (!raw) { notes = []; return; }
  try {
    const parsed = JSON.parse(raw);
    notes = Array.isArray(parsed)
      ? parsed.filter((note) => note && typeof note === "object").map(normalizeNote)
      : [];
  } catch (error) {
    notes = [];
    showNotification("Stored notes could not be read (corrupted data). Starting fresh.", "error", 5000);
  }
}

function readActiveNoteId() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.active) || null;
  } catch (error) {
    return null;
  }
}

function persistNotes() {
  if (!storageAvailable) {
    updateSaveStatus("error");
    return false;
  }
  try {
    window.localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes));
    window.localStorage.setItem(STORAGE_KEYS.active, activeNoteId || "");
    return true;
  } catch (error) {
    // Quota exceeded or storage blocked — never claim "Saved" when the write failed.
    console.error("Persisting notes failed:", error);
    updateSaveStatus("error");
    showNotification("Storage error: your change could not be saved. Free up space or export your note.", "error", 4200);
    return false;
  }
}

function normalizeNote(raw) {
  const nowIso = new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : generateId(),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 120) : DEFAULT_TITLE,
    content: typeof raw.content === "string" ? raw.content : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso,
  };
}

function generateId() {
  return window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentNote() {
  return notes.find((note) => note.id === activeNoteId) || null;
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (!storageAvailable) return;
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    updateSaveStatus("saving");
    saveCurrentNote({ silent: true });
  }, AUTOSAVE_DELAY_MS);
}

function saveCurrentNote({ silent = false } = {}) {
  const note = currentNote();
  if (!note) return false;
  note.content = markdownInput.value;
  note.updatedAt = new Date().toISOString();
  const ok = persistNotes();
  if (ok) {
    hasUnsavedChanges = false;
    updateSaveStatus("saved");
  }
  return ok;
}

function saveNote() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (!currentNote()) return;
  if (saveCurrentNote()) showNotification("Note saved");
}

function flushAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  if (hasUnsavedChanges && currentNote()) saveCurrentNote({ silent: true });
}

/* ==========================================================================
   Note management (create / select / rename / delete)
   ========================================================================== */

function createNoteObject(title = DEFAULT_TITLE, content = "") {
  const now = new Date().toISOString();
  return { id: generateId(), title, content, createdAt: now, updatedAt: now };
}

function newNote() {
  flushAutosave(); // never discard the outgoing note's changes
  const note = createNoteObject();
  notes.unshift(note);
  activeNoteId = note.id;
  persistNotes();
  hydrateFromActiveNote();
  renderNotesList();
  refreshView(storageAvailable ? "saved" : "error");
  markdownInput.focus();
  showNotification("New note created");
}

function selectNote(id) {
  if (id === activeNoteId) return;
  flushAutosave(); // persist the outgoing note before switching
  activeNoteId = id;
  persistNotes();
  hydrateFromActiveNote();
  renderNotesList();
  refreshView(storageAvailable ? "saved" : "error");
  if (isMobileLayout()) setSidebar(false);
}

async function deleteNote() {
  const note = currentNote();
  if (!note) return;
  const confirmed = await confirmAction({
    title: "Delete this note?",
    message: `“${note.title}” will be permanently deleted. This action cannot be undone.`,
    confirmLabel: "Delete note",
    danger: true,
  });
  if (!confirmed) return;
  notes = notes.filter((item) => item.id !== note.id);
  if (notes.length === 0) notes.push(createNoteObject());
  activeNoteId = notes[0].id;
  persistNotes();
  hydrateFromActiveNote();
  renderNotesList();
  refreshView(storageAvailable ? "saved" : "error");
  showNotification("Note deleted");
}

function beginRename() {
  const note = currentNote();
  if (!note || isRenaming) return;
  isRenaming = true;
  els.noteTitleButton.hidden = true;
  els.noteTitleInput.hidden = false;
  els.noteTitleInput.value = note.title;
  els.noteTitleInput.focus();
  els.noteTitleInput.select();
}

function commitRename() {
  if (!isRenaming) return;
  isRenaming = false;
  els.noteTitleButton.hidden = false;
  els.noteTitleInput.hidden = true;
  const note = currentNote();
  if (!note) return;
  const nextTitle = els.noteTitleInput.value.trim() || DEFAULT_TITLE;
  if (nextTitle === note.title) return;
  note.title = nextTitle;
  note.updatedAt = new Date().toISOString();
  persistNotes();
  syncNoteTitle(note);
  renderNotesList();
  showNotification("Note renamed");
}

/* ==========================================================================
   Formatting toolbar + keyboard shortcuts
   ========================================================================== */

function applyFormatting(action) {
  switch (action) {
    case "heading": transformLines(toggleLinePrefixer("## ")); break;
    case "bold": wrapSelection("**", "**", "bold text"); break;
    case "italic": wrapSelection("*", "*", "italic text"); break;
    case "strike": wrapSelection("~~", "~~", "struck text"); break;
    case "ul": transformLines(toggleLinePrefixer("- ")); break;
    case "ol": transformLines(orderedListPrefixer); break;
    case "quote": transformLines(toggleLinePrefixer("> ")); break;
    case "code": wrapSelection("`", "`", "code"); break;
    case "link": insertLink(); break;
    default: break;
  }
}

// Wraps the selection (or a placeholder) with the given markers; toggles off if already wrapped.
function wrapSelection(before, after, placeholder) {
  const start = markdownInput.selectionStart;
  const end = markdownInput.selectionEnd;
  const value = markdownInput.value;
  const selected = value.slice(start, end) || placeholder;

  if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    markdownInput.value = value.slice(0, start - before.length) + value.slice(start, end) + value.slice(end + after.length);
    markdownInput.setSelectionRange(start - before.length, end - before.length);
  } else {
    markdownInput.value = value.slice(0, start) + before + selected + after + value.slice(end);
    markdownInput.setSelectionRange(start + before.length, start + before.length + selected.length);
  }
  markdownInput.focus();
  markdownInput.dispatchEvent(new Event("input", { bubbles: true }));
}

// Applies a line-level transform (lists, quotes, headings) to the affected lines.
function transformLines(prefixer) {
  const value = markdownInput.value;
  const start = markdownInput.selectionStart;
  const end = markdownInput.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;

  const originalLines = value.slice(lineStart, lineEnd).split("\n");
  const transformedLines = prefixer(originalLines);
  const transformedBlock = transformedLines.join("\n");

  markdownInput.value = value.slice(0, lineStart) + transformedBlock + value.slice(lineEnd);
  markdownInput.setSelectionRange(lineStart, lineStart + transformedBlock.length);
  markdownInput.focus();
  markdownInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function toggleLinePrefixer(prefix) {
  return (lines) => {
    const allPrefixed = lines.every((line) => line.startsWith(prefix));
    if (allPrefixed) return lines.map((line) => line.slice(prefix.length));
    return lines.map((line) => (line.startsWith(prefix) ? line : prefix + line));
  };
}

function orderedListPrefixer(lines) {
  const allNumbered = lines.every((line) => /^\d+\.\s/.test(line));
  if (allNumbered) return lines.map((line) => line.replace(/^\d+\.\s/, ""));
  let counter = 0;
  return lines.map((line) => (/^\d+\.\s/.test(line) ? line : `${++counter}. ${line}`));
}

function insertLink() {
  const start = markdownInput.selectionStart;
  const end = markdownInput.selectionEnd;
  const value = markdownInput.value;
  const selected = value.slice(start, end);

  if (selected.trim() && /^https?:\/\//i.test(selected.trim())) {
    markdownInput.value = `${value.slice(0, start)}[link text](${selected})${value.slice(end)}`;
    markdownInput.setSelectionRange(start + 1, start + 10); // select "link text"
  } else {
    const label = selected || "link text";
    const url = "https://example.com";
    markdownInput.value = `${value.slice(0, start)}[${label}](${url})${value.slice(end)}`;
    const urlStart = start + label.length + 3;
    markdownInput.setSelectionRange(urlStart, urlStart + url.length); // select the URL
  }
  markdownInput.focus();
  markdownInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function handleShortcuts(event) {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) {
    if (event.key === "Escape") closeAllMenus();
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    saveNote();
  } else if ((key === "b" || key === "i") && document.activeElement === markdownInput) {
    event.preventDefault();
    applyFormatting(key === "b" ? "bold" : "italic");
  }
}

/* ==========================================================================
   Editor actions (clear / sample)
   ========================================================================== */

async function clearEditor() {
  if (!markdownInput.value.trim()) {
    showNotification("The editor is already empty");
    return;
  }
  const confirmed = await confirmAction({
    title: "Clear this editor?",
    message: "All content in the current note will be removed. The change is then persisted as usual by autosave.",
    confirmLabel: "Clear editor",
    danger: true,
  });
  if (!confirmed) return;
  markdownInput.value = "";
  markdownInput.focus();
  markdownInput.dispatchEvent(new Event("input", { bubbles: true }));
  showNotification("Editor cleared");
}

async function insertSample() {
  if (markdownInput.value.trim()) {
    const confirmed = await confirmAction({
      title: "Replace current content?",
      message: "Inserting the sample note will replace the current note's content.",
      confirmLabel: "Insert sample",
      danger: false,
    });
    if (!confirmed) return;
  }
  markdownInput.value = SAMPLE_CONTENT;
  markdownInput.dispatchEvent(new Event("input", { bubbles: true }));
  markdownInput.focus();
  const end = markdownInput.value.length;
  markdownInput.setSelectionRange(end, end);
  showNotification("Sample note inserted");
}

/* ==========================================================================
   Downloads (Markdown + standalone HTML)
   ========================================================================== */

function sanitizeFilename(title, extension) {
  const base = title
    .trim()
    .replace(/[^a-zA-Z0-9\-_ ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "untitled-note"}.${extension}`;
}

function triggerDownload(content, filename, mimeType) {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (error) {
    console.error("Download failed:", error);
    showNotification("Download failed in this browser.", "error");
    return false;
  }
}

function downloadMarkdown() {
  const note = currentNote();
  if (!note) return;
  const ok = triggerDownload(note.content, sanitizeFilename(note.title, "md"), "text/markdown;charset=utf-8");
  if (ok) showNotification("Markdown download started");
}

function downloadHTML() {
  const note = currentNote();
  if (!note) return;
  const ok = triggerDownload(
    buildStandaloneHTML(note),
    sanitizeFilename(note.title, "html"),
    "text/html;charset=utf-8"
  );
  if (ok) showNotification("HTML download started");
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Builds a complete, standalone HTML5 document with embedded styles and sanitized content.
function buildStandaloneHTML(note) {
  const title = note.title || DEFAULT_TITLE;
  const body = renderMarkdown(note.content && note.content.trim() ? note.content : "*This note is empty.*");
  const exportedOn = new Date().toLocaleDateString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Markdown Studio Pro">
<title>${escapeHTML(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 24px; background: #F9F8F6; color: #1A1D20;
         font: 16px/1.75 Lora, Georgia, "Times New Roman", serif; }
  main { max-width: 760px; margin: 0 auto; }
  .note-label { font: 600 11px/1 system-ui, sans-serif; letter-spacing: .12em;
                text-transform: uppercase; color: #686D76; margin: 0 0 8px; }
  h1, h2, h3, h4, h5, h6 { font-family: system-ui, -apple-system, sans-serif;
                           line-height: 1.3; margin: 1.6em 0 .6em; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
  h1, h2 { border-bottom: 1px solid #E5E2DC; padding-bottom: .3em; }
  p { margin: .9em 0; }
  a { color: #4F46E5; }
  ul, ol { padding-left: 1.5em; }
  code { font: .875em/1 "JetBrains Mono", Consolas, monospace; background: #F3F1EC;
         border: 1px solid #E5E2DC; border-radius: 4px; padding: .1em .35em; }
  pre { background: #F3F1EC; border: 1px solid #E5E2DC; border-radius: 8px;
        padding: 16px; overflow-x: auto; line-height: 1.6; }
  pre code { background: none; border: 0; padding: 0; }
  blockquote { margin: 1em 0; padding: .1em 0 .1em 1.2em;
               border-left: 3px solid #4F46E5; color: #686D76; font-style: italic; }
  hr { border: 0; border-top: 1px solid #E5E2DC; margin: 2em 0; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #E5E2DC; padding: 8px 12px; text-align: left; }
  th { background: #F3F1EC; }
  footer { max-width: 760px; margin: 40px auto 0;
           font: 12px system-ui, sans-serif; color: #686D76; }
</style>
</head>
<body>
<main>
<p class="note-label">${escapeHTML(title)}</p>
${body}
</main>
<footer>Exported from Markdown Studio Pro — ${escapeHTML(exportedOn)}</footer>
</body>
</html>`;
}

/* ==========================================================================
   Theme, layout, sidebar
   ========================================================================== */

function readTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.theme);
    if (stored === "light" || stored === "dark") return stored;
  } catch (error) { /* fall through to system preference */ }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  els.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  try {
    window.localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch (error) { /* non-fatal */ }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

function readLayout() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.layout);
    if (["split", "editor", "preview"].includes(stored)) return stored;
  } catch (error) { /* ignore */ }
  return "split";
}

function applyLayout(mode) {
  els.app.dataset.layout = mode;
  const buttons = { split: els.layoutSplit, editor: els.layoutEditor, preview: els.layoutPreview };
  Object.entries(buttons).forEach(([name, button]) => {
    const isActive = name === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  try {
    window.localStorage.setItem(STORAGE_KEYS.layout, mode);
  } catch (error) { /* non-fatal */ }
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 880px)").matches;
}

function setSidebar(open) {
  sidebarOpen = open;
  els.app.dataset.sidebar = open ? "open" : "collapsed";
  els.sidebarToggle.setAttribute("aria-expanded", String(open));
  els.sidebarBackdrop.hidden = !(open && isMobileLayout());
}

/* ==========================================================================
   Dropdown menus, dialogs, toasts
   ========================================================================== */

function setupDropdown(button, menu) {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = !menu.hidden;
    closeAllMenus();
    if (!wasOpen) {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
    }
  });
}

function closeAllMenus() {
  document.querySelectorAll(".menu").forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll("[aria-haspopup]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function confirmAction({ title, message, confirmLabel = "Confirm", danger = true }) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmOkButton.textContent = confirmLabel;
    els.confirmOkButton.classList.toggle("danger-button", danger);
    els.confirmOkButton.classList.toggle("primary-button", !danger);
    confirmResolve = resolve;
    els.confirmDialog.showModal();
  });
}

function showNotification(message, type = "success", duration = 2600) {
  const toast = document.createElement("div");
  toast.className = type === "error" ? "toast toast-error" : "toast";
  toast.setAttribute("role", "status");
  toast.dataset.testid = "toast";
  toast.textContent = message;
  els.toastRegion.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("toast-out");
    window.setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ==========================================================================
   Sidebar rendering helpers
   ========================================================================== */

function hydrateFromActiveNote() {
  const note = currentNote();
  markdownInput.value = note ? note.content : "";
  syncNoteTitle(note);
}

function syncNoteTitle(note) {
  const title = note && note.title ? note.title : DEFAULT_TITLE;
  els.noteTitleText.textContent = title;
  document.title = `${title} — Markdown Studio Pro`;
}

function renderNotesList() {
  els.notesList.replaceChildren();
  for (const note of notes) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `note-item${note.id === activeNoteId ? " is-selected" : ""}`;
    item.dataset.testid = "note-item";
    item.dataset.noteId = note.id;
    if (note.id === activeNoteId) item.setAttribute("aria-current", "true");

    const title = document.createElement("span");
    title.className = "note-item-title";
    title.textContent = note.title || DEFAULT_TITLE;

    const time = document.createElement("span");
    time.className = "note-item-time";
    time.textContent = formatRelative(note.updatedAt);

    item.append(title, time);
    item.addEventListener("click", () => selectNote(note.id));

    const listItem = document.createElement("li");
    listItem.append(item);
    els.notesList.append(listItem);
  }
  els.sidebarEmpty.hidden = notes.length > 0;
}

function formatRelative(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 45000) return "just now";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(isoString).toLocaleDateString();
}

// Renders preview + counts without marking the note dirty (used at load/switch time).
function refreshView(status) {
  renderPreviewOutput();
  updateCounts();
  hasUnsavedChanges = false;
  updateSaveStatus(status);
}

/* ---------- Boot ---------- */
initializeApp();
