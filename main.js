// Generated from candidate/main-before-bundle.js and candidate/note-core.js.
"use strict";

const { Plugin, MarkdownRenderChild, Modal, Notice, TFile, setIcon } = require("obsidian");
const core = (() => {
  const module = { exports: {} };
"use strict";

// Pure functions. No Obsidian, filesystem, network, clocks, or mutable task state.
const ALLOWED_PATHS = Object.freeze([
  "Wiki/行动管理/每日行动看板.md",
  "Wiki/行动管理/待办积压库.md"
]);
const DETAIL_BEGIN = "<!-- action-detail:begin -->";
const DETAIL_END = "<!-- action-detail:end -->";
const STATUS_BEGIN = "<!-- action-card-status:begin -->";
const STATUS_END = "<!-- action-card-status:end -->";
const TASK = /^- \[[ xX]\] \S/;

class NoteSafetyError extends Error {
  constructor(code, message) { super(message); this.name = "NoteSafetyError"; this.code = code; }
}
function fail(code, message) { throw new NoteSafetyError(code, message); }
function allowedPath(path) { return ALLOWED_PATHS.includes(path); }
function lf(text) { return text.replace(/\r\n?/g, "\n"); }

function sourceLines(source) {
  const result = [];
  const matcher = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  for (const match of source.matchAll(matcher)) {
    if (!match[0]) continue;
    const raw = match[0];
    const eol = /(?:\r\n|\n|\r)$/.exec(raw)?.[0] || "";
    result.push({ text: raw.slice(0, raw.length - eol.length), start: match.index,
      contentEnd: match.index + raw.length - eol.length, end: match.index + raw.length, eol });
  }
  return result;
}

// Exclude frontmatter, fenced examples/queries, HTML comments, and indented/quoted tasks.
function taskLineNumbers(source) {
  const lines = sourceLines(source);
  const result = [];
  let fence = null;
  let frontmatter = lines[0]?.text.replace(/^\uFEFF/, "") === "---";
  let comment = false;
  let pfgDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    if (/<!--\s*PFG-(?:SUMMARY|CHOICE)[^>]*:BEGIN\s*-->/i.test(text)) { pfgDepth++; continue; }
    if (/<!--\s*PFG-(?:SUMMARY|CHOICE)[^>]*:END\s*-->/i.test(text)) { pfgDepth = Math.max(0, pfgDepth - 1); continue; }
    if (pfgDepth) continue;
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)$/.test(text)) frontmatter = false;
      continue;
    }
    if (comment) {
      if (text.includes("-->")) comment = false;
      continue;
    }
    if (fence) {
      const closer = new RegExp("^ {0,3}" + fence.char + "{" + fence.length + ",}\\s*$");
      if (closer.test(text)) fence = null;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (opening) { fence = { char: opening[1][0], length: opening[1].length }; continue; }
    if (text.includes("<!--") && !text.slice(text.indexOf("<!--") + 4).includes("-->")) {
      comment = true; continue;
    }
    if (TASK.test(text)) result.push(i);
  }
  return result;
}

function validatePath(path) {
  if (!allowedPath(path)) fail("PATH", "这个页面不支持任务备注。");
}
function isBoundary(text) {
  return /^#{1,6}\s/.test(text) || /^- \[[^\]]\]\s/.test(text) || /^(---+|\*\*\*+)\s*$/.test(text);
}
function isLegacyPlainText(text) {
  return text.length > 0 && !/^\s/.test(text) &&
    !/^(?:[-+*]\s|#{1,6}\s|>|`{3}|~{3}|<|\|)/.test(text) &&
    !/<!--|action-detail:|action-card-status:|PFG[-:]/i.test(text);
}

function inspectTask(source, path, lineNo) {
  validatePath(path);
  const lines = sourceLines(source);
  const candidates = taskLineNumbers(source);
  if (!Number.isInteger(lineNo) || !candidates.includes(lineNo)) fail("TASK", "无法确认原文中的顶层任务。");
  const taskLine = lines[lineNo].text;
  if (/PFG[-:]|PFG-TASK|PFG-CHOICE|PFG-SUMMARY/i.test(taskLine)) fail("PFG", "文件处理任务使用自己的确认入口。");
  const sameLineCount = candidates.filter(i => lines[i].text === taskLine).length;
  let cursor = lineNo + 1;
  while (cursor < lines.length && !lines[cursor].text.trim()) cursor++;
  // Read-only compatibility: an existing plain-text note stays exactly where it was.
  // Accept it only when a single existing wrapper follows; never create/move legacy notes.
  if (cursor < lines.length && lines[cursor].text !== DETAIL_BEGIN && !isBoundary(lines[cursor].text)) {
    let legacyCount = 0;
    while (cursor < lines.length && lines[cursor].text !== DETAIL_BEGIN) {
      const text = lines[cursor].text;
      if (text.trim() && (!isLegacyPlainText(text) || ++legacyCount > 20)) {
        fail("ATTACHMENT", "任务后的旧正文结构不明确，请用原生编辑处理。");
      }
      cursor++;
    }
    if (cursor >= lines.length) fail("ATTACHMENT", "旧备注后没有唯一既有详情区域，未写入。");
  }
  let wrapperEnd = null;
  let statusOpen = false;
  let statusPairs = 0;
  if (lines[cursor]?.text === DETAIL_BEGIN) {
    for (let i = cursor + 1; i < lines.length; i++) {
      const text = lines[i].text;
      if (text === DETAIL_END) {
        if (statusOpen) fail("WRAPPER", "当前进展区域缺少结束标记。");
        wrapperEnd = i; break;
      }
      if (text === DETAIL_BEGIN || isBoundary(text)) fail("WRAPPER", "详情区域存在嵌套、缺尾或跨任务情况。");
      if (text.includes("action-detail:") || (/action-card-status:/.test(text) && text !== STATUS_BEGIN && text !== STATUS_END)) {
        fail("WRAPPER", "详情标记格式不明确，未写入备注。");
      }
      if (text === STATUS_BEGIN) {
        if (statusOpen || statusPairs > 0) fail("WRAPPER", "当前进展区域重复或嵌套。");
        statusOpen = true;
      }
      if (text === STATUS_END) {
        if (!statusOpen) fail("WRAPPER", "当前进展区域标记不完整。");
        statusOpen = false; statusPairs++;
      }
      if (/PFG[-:]/i.test(text)) fail("PFG", "文件处理区域不使用通用备注入口。");
    }
    if (wrapperEnd === null) fail("WRAPPER", "详情区域缺少结束标记。");
    cursor = wrapperEnd + 1;
    while (cursor < lines.length && !lines[cursor].text.trim()) cursor++;
  }
  if (cursor < lines.length && !isBoundary(lines[cursor].text)) {
    fail("ATTACHMENT", "任务后还有不明归属的正文，请用原生编辑处理。");
  }
  const lastLine = wrapperEnd === null ? lineNo : wrapperEnd;
  const blockStart = lines[lineNo].start;
  const blockEnd = lines[lastLine].contentEnd;
  const block = source.slice(blockStart, blockEnd);
  if (/PFG[-:]/i.test(block)) fail("PFG", "文件处理任务不使用通用备注入口。");
  return { path, lineNo, taskLine, sameLineCount, block, blockStart, blockEnd, wrapperEnd,
    insertAt: wrapperEnd === null ? lines[lineNo].contentEnd : lines[wrapperEnd].start,
    eol: lines[lineNo].eol || lines.find(line => line.eol)?.eol || "\n" };
}

function captureFromSection(source, path, section, position = {}) {
  validatePath(path);
  if (!section || !Number.isInteger(section.lineStart) || !Number.isInteger(section.lineEnd) ||
      section.lineStart < 0 || section.lineEnd < section.lineStart || typeof section.text !== "string") {
    fail("SECTION", "无法取得可靠的原文位置。");
  }
  const lines = sourceLines(source);
  if (section.lineEnd >= lines.length) fail("SECTION", "页面与原文位置已经变化。");
  const sectionText = lines.slice(section.lineStart, section.lineEnd + 1).map(line => line.text).join("\n");
  const observed = lf(section.text).replace(/\n$/, "");
  // Host versions may return the section text or the whole source text.
  if (observed !== sectionText && observed !== lf(source).replace(/\n$/, "")) {
    fail("SECTION_CHANGED", "页面内容已变化，请重新打开任务。");
  }
  const candidates = taskLineNumbers(source).filter(i => i >= section.lineStart && i <= section.lineEnd);
  const parseOffset = value => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
      fail("POSITION", "任务的原文行号不可靠，未打开备注。");
    }
    return Number(value);
  };
  const liOffset = parseOffset(position.liDataLine);
  const inputOffset = parseOffset(position.inputDataLine);
  if (liOffset !== null && inputOffset !== null && liOffset !== inputOffset) {
    fail("POSITION", "任务与勾选框的原文位置不一致。");
  }
  if (candidates.length !== 1 && (liOffset === null || inputOffset === null)) {
    fail("SECTION_AMBIGUOUS", "这个渲染区的任务缺少精确行号，保留原生编辑入口。");
  }
  // data-line is a source-line offset, not a task ordinal: ordinary list lines count too.
  const offset = liOffset ?? inputOffset;
  const lineNo = offset === null ? candidates[0] : section.lineStart + offset;
  if (!Number.isSafeInteger(lineNo) || lineNo < section.lineStart || lineNo > section.lineEnd || !candidates.includes(lineNo)) {
    fail("POSITION", "原文行号未指向这个渲染区中的顶层任务。");
  }
  const task = inspectTask(source, path, lineNo);
  return Object.freeze({ path, lineNo: task.lineNo, taskLine: task.taskLine, block: task.block,
    sameLineCount: task.sameLineCount, sourcePreimage: source });
}

function literalNote(input, eol) {
  if (typeof input !== "string" || !input.trim()) fail("EMPTY", "请先输入备注。");
  // Numeric entities preserve punctuation as text, including Obsidian's %%/==/~~/$/^ syntax.
  // Encode in one pass so entity delimiters themselves are never double-encoded.
  const literal = lf(input.trim()).replace(/[!-/:-@\[-`{-~]/g, char => "&#" + char.charCodeAt(0) + ";");
  return "> [!note]- 我的备注" + eol + literal.split("\n").map(line => line ? "> " + line : ">").join(eol);
}

function assertSnapshotCurrent(currentSource, snapshot) {
  if (!snapshot) fail("SNAPSHOT", "缺少任务原文，未写入备注。");
  const current = inspectTask(currentSource, snapshot.path, snapshot.lineNo);
  if (current.taskLine !== snapshot.taskLine || current.block !== snapshot.block) {
    fail("CONFLICT", "任务或详情已变化；备注仍保留，请复制后重新打开此任务。");
  }
  // Identical tasks have no unique text identity. Keep their exact source position only
  // while the whole file remains byte-for-byte identical to the captured preimage.
  if ((snapshot.sameLineCount > 1 || current.sameLineCount > 1) && currentSource !== snapshot.sourcePreimage) {
    fail("CONFLICT", "页面含相同任务且原文已变化；备注仍保留，请重新打开此任务。");
  }
  return current;
}

function appendNote(currentSource, snapshot, input) {
  const current = assertSnapshotCurrent(currentSource, snapshot);
  const callout = literalNote(input, current.eol);
  const insertion = current.wrapperEnd === null
    ? current.eol + current.eol + DETAIL_BEGIN + current.eol + callout + current.eol + DETAIL_END
    : current.eol + callout + current.eol;
  return currentSource.slice(0, current.insertAt) + insertion + currentSource.slice(current.insertAt);
}

function titleForDisplay(snapshot) {
  return snapshot.taskLine.replace(/^- \[[ xX]\] /, "").replace(/<!--.*?-->/g, "").replace(/\*\*/g, "").trim();
}

module.exports = { ALLOWED_PATHS, NoteSafetyError, allowedPath, sourceLines, taskLineNumbers,
  inspectTask, captureFromSection, assertSnapshotCurrent, literalNote, appendNote, titleForDisplay };

  return module.exports;
})();
const EXCLUDED = ".markdown-embed, .internal-embed, .block-language-tasks, .tasks-query-result, .plugin-tasks-query-result, .callout, blockquote, pre, code";

class TaskNoteModal extends Modal {
  constructor(plugin, snapshot) {
    super(plugin.app);
    this.plugin = plugin;
    this.snapshot = snapshot;
    this.saving = false;
  }
  onOpen() {
    const el = this.contentEl;
    el.addClass("wispvale-note-modal");
    el.createEl("h2", { text: "添加备注" });
    el.createEl("p", { text: core.titleForDisplay(this.snapshot), cls: "wispvale-note-task-title" });
    el.createEl("p", { text: "备注保存到这项任务的详情中，不改变勾选状态。", cls: "wispvale-note-hint" });
    const label = el.createEl("label", { text: "我的备注", cls: "wispvale-note-label" });
    this.input = el.createEl("textarea", { cls: "wispvale-note-input", attr: { rows: "6", placeholder: "输入备注（纯文字）", "aria-label": "我的备注" } });
    label.htmlFor = this.input.id = "wispvale-note-input-" + Math.random().toString(36).slice(2);
    this.errorEl = el.createEl("p", { cls: "wispvale-note-error", attr: { role: "status", "aria-live": "polite" } });
    const actions = el.createDiv({ cls: "wispvale-note-actions" });
    this.cancelButton = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    this.saveButton = actions.createEl("button", { text: "保存备注", cls: "mod-cta", attr: { type: "button" } });
    this.cancelButton.addEventListener("click", () => { if (!this.saving) this.close(); });
    this.saveButton.addEventListener("click", () => this.save());
    this.input.focus();
  }
  close() { if (!this.saving) super.close(); }
  async save() {
    if (this.saving || !this.plugin.active) return;
    if (!this.input.value.trim()) { this.errorEl.textContent = "请先输入备注。"; this.input.focus(); return; }
    const value = this.input.value;
    const file = this.app.vault.getAbstractFileByPath(this.snapshot.path);
    if (!(file instanceof TFile) || !core.allowedPath(file.path)) {
      this.errorEl.textContent = "原文件已移动或无法访问；备注仍保留。"; return;
    }
    this.saving = true;
    this.saveButton.disabled = this.cancelButton.disabled = true;
    this.input.readOnly = true;
    this.errorEl.textContent = "";
    let saved = false;
    try {
      await this.app.vault.process(file, current => {
        if (!this.plugin.active || file.path !== this.snapshot.path) throw new Error("插件或文件状态已变化；备注未提交。");
        return core.appendNote(current, this.snapshot, value);
      });
      saved = true;
    } catch (error) {
      // Do not clear, rebase, retry, or log the user's private input.
      this.errorEl.textContent = error instanceof core.NoteSafetyError ? error.message : "保存失败；输入仍保留。请复制备注后检查文件再重试。";
    } finally {
      this.saving = false;
      this.saveButton.disabled = this.cancelButton.disabled = false;
      this.input.readOnly = false;
    }
    if (saved) { new Notice("备注已保存，任务状态保持不变。"); this.close(); }
  }
}

class TaskNoteControl extends MarkdownRenderChild {
  constructor(plugin, li, context) {
    super(li); this.plugin = plugin; this.li = li; this.context = context; this.disposed = false;
    this.positionKey = this.domPositionKey();
  }
  async onload() {
    let initialized = false;
    try {
    if (!this.plugin.active || !this.ownsControl() || !(await this.waitForReadingView()) || !this.ownsControl()) return;
    const file = this.plugin.app.vault.getAbstractFileByPath(this.context.sourcePath);
    if (!(file instanceof TFile)) return;
    try {
      const source = await this.plugin.app.vault.read(file);
      if (this.disposed || !this.plugin.active || !this.ownsControl() || !this.isEligible()) return;
      this.snapshot = this.captureSnapshot(source, file.path);
      this.positionKey = this.domPositionKey();
    } catch (_) { return; } // Ambiguity leaves the native task unchanged.
    if (this.disposed || !this.plugin.active || !this.ownsControl()) return;
    const doc = this.li.ownerDocument;
    this.button = doc.createElement("button");
    this.button.type = "button";
    this.button.className = "wispvale-task-note-button";
    this.button.setAttribute("aria-label", "为此任务添加备注");
    this.button.setAttribute("title", "添加备注");
    setIcon(this.button, "message-square-plus");
    this.li.classList.add("wispvale-note-enabled");
    this.li.appendChild(this.button);
    this.registerDomEvent(this.button, "click", async event => {
      event.preventDefault(); event.stopPropagation();
      if (!this.plugin.active || this.disposed || !this.ownsControl()) return;
      // Re-check the current rendered source; a stale view never chooses a new task.
      try {
        const latest = await this.plugin.app.vault.read(file);
        if (!this.plugin.active || this.disposed || !this.ownsControl() || !this.isEligible()) return;
        const observed = this.captureSnapshot(latest, file.path);
        core.assertSnapshotCurrent(latest, this.snapshot);
        if (observed.lineNo !== this.snapshot.lineNo || observed.taskLine !== this.snapshot.taskLine || observed.block !== this.snapshot.block) {
          throw new core.NoteSafetyError("CONFLICT", "任务已经变化，请重新打开页面后添加备注。");
        }
        new TaskNoteModal(this.plugin, observed).open();
      } catch (error) { new Notice(error instanceof core.NoteSafetyError ? error.message : "无法定位原任务，请使用原生编辑。"); }
    });
    this.register(() => this.removeControlUI());
    initialized = true;
    } catch (_) {
      // A failed initialization must not reserve a cached li forever.
    } finally {
      if (!initialized) { this.removeControlUI(); this.releaseReservation(); }
    }
  }
  ownsControl() { return this.plugin.controlOwners.get(this.li) === this; }
  domPositionKey() {
    return JSON.stringify([this.li.getAttribute("data-line"),
      Array.from(this.li.querySelectorAll("input.task-list-item-checkbox"))
        .filter(input => input.closest("li") === this.li).map(input => input.getAttribute("data-line"))]);
  }
  captureSnapshot(source, path) {
    const checkboxes = Array.from(this.li.querySelectorAll("input.task-list-item-checkbox"))
      .filter(input => input.closest("li") === this.li);
    if (checkboxes.length !== 1 || checkboxes[0].type !== "checkbox") {
      throw new core.NoteSafetyError("POSITION", "无法确认任务对应的勾选框。");
    }
    return core.captureFromSection(source, path, this.context.getSectionInfo(this.li), {
      liDataLine: this.li.getAttribute("data-line"),
      inputDataLine: checkboxes[0].getAttribute("data-line")
    });
  }
  removeControlUI() {
    this.button?.remove();
    this.button = null;
    if (this.plugin.controlOwners.get(this.li) === this) this.li.classList.remove("wispvale-note-enabled");
  }
  releaseReservation() {
    // A late cleanup from an old renderer cannot release a replacement's reservation.
    if (this.plugin.controlOwners.get(this.li) === this) {
      this.plugin.controlOwners.delete(this.li);
      this.plugin.seen.delete(this.li);
    }
    this.plugin.activeControls.delete(this);
  }
  isEligible() {
    if (!core.allowedPath(this.context.sourcePath) || !this.li.closest(".markdown-preview-view")) return false;
    if (this.li.closest(EXCLUDED) || this.li.parentElement?.closest("li")) return false;
    const checkboxes = Array.from(this.li.querySelectorAll("input.task-list-item-checkbox"))
      .filter(input => input.closest("li") === this.li);
    return checkboxes.length === 1 && checkboxes[0].type === "checkbox";
  }
  waitForReadingView() {
    // A renderer may load its child before attaching the section to the reading view.
    // Bound the wait, cancel on unload, and never register a second control.
    return new Promise(resolve => {
      const delays = [25, 50, 100, 200, 400, 800];
      const win = this.li.ownerDocument.defaultView;
      let timer = null;
      let attempt = 0;
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        if (timer !== null) win.clearTimeout(timer);
        this.cancelMountWait = null;
        resolve(result);
      };
      const check = () => {
        if (this.disposed || !this.plugin.active || !this.ownsControl()) return finish(false);
        if (this.isEligible()) return finish(true);
        if (attempt === delays.length) return finish(false);
        timer = win.setTimeout(check, delays[attempt++]);
      };
      this.cancelMountWait = () => finish(false);
      check();
    });
  }
  onunload() {
    this.disposed = true;
    this.cancelMountWait?.();
    this.removeControlUI();
    this.releaseReservation();
  }
}

class TaskNoteSection extends MarkdownRenderChild {
  constructor(plugin, root, context) {
    super(root); this.plugin = plugin; this.root = root; this.context = context;
    this.controls = new Map(); this.disposed = false; this.scanTimer = null;
  }
  onload() {
    if (!this.plugin.active) return;
    const owner = this.plugin.sectionOwners.get(this.root);
    if (owner && owner !== this) return;
    this.plugin.sectionOwners.set(this.root, this);
    this.plugin.activeSections.add(this);
    this.disposed = false;
    const win = this.root.ownerDocument.defaultView;
    // Tasks can replace each li asynchronously after the initial postprocessor pass.
    // Watch only this rendered section, including delayed data-line assignments.
    this.observer = new win.MutationObserver(() => this.scheduleScan());
    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-line"] });
    // Cached offscreen sections may attach long after a control's bounded mount wait.
    // Revisit only this section when it becomes visible; no offscreen polling.
    this.visibilityObserver = new win.IntersectionObserver(entries => {
      if (entries.some(entry => entry.target === this.root && entry.isIntersecting)) this.scheduleScan();
    });
    this.visibilityObserver.observe(this.root);
    this.scan();
  }
  scheduleScan() {
    if (this.disposed || !this.plugin.active || this.scanTimer !== null) return;
    this.scanTimer = this.root.ownerDocument.defaultView.setTimeout(() => {
      this.scanTimer = null; this.scan();
    }, 0);
  }
  scan() {
    if (this.disposed || !this.plugin.active || this.plugin.sectionOwners.get(this.root) !== this) return;
    const items = new Set(Array.from(this.root.querySelectorAll("li.task-list-item"))
      .filter(li => !li.closest(EXCLUDED) && !li.parentElement?.closest("li")));
    for (const [li, child] of this.controls) {
      if (!items.has(li) || !child.ownsControl() || child.disposed || child.positionKey !== child.domPositionKey() ||
          (child.button && child.button.parentElement !== li)) {
        this.controls.delete(li);
        this.removeChild(child);
        child.onunload();
      }
    }
    for (const li of items) {
      if (this.plugin.seen.has(li)) continue;
      const child = new TaskNoteControl(this.plugin, li, this.context);
      this.controls.set(li, child);
      this.plugin.seen.add(li);
      this.plugin.controlOwners.set(li, child);
      this.plugin.activeControls.add(child);
      try { this.addChild(child); }
      catch (_) { child.onunload(); this.removeChild(child); this.controls.delete(li); }
    }
  }
  onunload() {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    if (this.scanTimer !== null) this.root.ownerDocument.defaultView.clearTimeout(this.scanTimer);
    this.scanTimer = null;
    for (const child of this.controls.values()) { this.removeChild(child); child.onunload(); }
    this.controls.clear();
    if (this.plugin.sectionOwners.get(this.root) === this) this.plugin.sectionOwners.delete(this.root);
    this.plugin.activeSections.delete(this);
  }
}

module.exports = class WispvaleActionNotes extends Plugin {
  onload() {
    this.active = true;
    this.seen = new WeakSet();
    this.controlOwners = new WeakMap();
    this.activeControls = new Set();
    this.sectionOwners = new WeakMap();
    this.activeSections = new Set();
    this.registerMarkdownPostProcessor((el, context) => {
      if (!core.allowedPath(context.sourcePath)) return;
      // Tasks also renders plain description spans with a null-only section context.
      // Such a callback must not claim the enclosing native list's ownership.
      if (!el.matches("li.task-list-item") && !el.querySelector("li.task-list-item")) return;
      const root = el.closest(".el-ul") || (el.matches("li.task-list-item") ? el.parentElement : el);
      if (!root || !root.querySelector("li.task-list-item") || this.sectionOwners.has(root)) return;
      const section = new TaskNoteSection(this, root, context);
      this.sectionOwners.set(root, section);
      this.activeSections.add(section);
      try { context.addChild(section); }
      catch (_) { section.onunload(); }
    }, 100);
  }
  onunload() {
    this.active = false;
    for (const section of Array.from(this.activeSections)) section.unload();
    this.activeSections.clear();
    for (const child of Array.from(this.activeControls)) child.unload();
    this.activeControls.clear();
  }
};
