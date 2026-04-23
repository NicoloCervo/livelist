import { Editor, MarkdownFileInfo, MarkdownView, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, LiveListSettings, PluginData } from "./types";
import { LiveListSettingTab } from "./settings";
import {
  findListBoundaries,
  parseListBlocks,
  refreshPositions,
  sortBlocks,
} from "./listManager";

export default class LiveListPlugin extends Plugin {
  settings: LiveListSettings = DEFAULT_SETTINGS;
  private pluginData: PluginData = { settings: DEFAULT_SETTINGS, items: {} };
  private _isSorting = false;
  private _contentCache: Map<string, string> = new Map();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new LiveListSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("editor-change", this.onEditorChange.bind(this))
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        this.app.vault.read(file).then((content) => {
          this._contentCache.set(file.path, content);
          this.log("cache warmed for", file.path);
        });
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        if (this.pluginData.items[file.path]) {
          delete this.pluginData.items[file.path];
          this.saveSettings();
          this.log("pruned data for deleted file", file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (this.pluginData.items[oldPath]) {
          this.pluginData.items[file.path] = this.pluginData.items[oldPath];
          delete this.pluginData.items[oldPath];
          this.saveSettings();
          this.log("migrated data", oldPath, "→", file.path);
        }
      })
    );

    this.log("loaded, autoSort =", this.settings.autoSort);
  }

  async onunload(): Promise<void> {
    this._contentCache.clear();
    this.log("unloaded");
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginData> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved?.settings ?? {});
    this.pluginData = {
      settings: this.settings,
      items: saved?.items ?? {},
    };
  }

  async saveSettings(): Promise<void> {
    this.pluginData.settings = this.settings;
    await this.saveData(this.pluginData);
  }

  private log(...args: unknown[]): void {
    if (this.settings.debugLogging) console.debug("[livelist]", ...args);
  }

  private isLiveListNote(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.tags) return false;
    return cache.tags.some((t) => t.tag === "#livelist");
  }

  private onEditorChange(editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    if (!this.settings.autoSort) return;
    if (this._isSorting) return;

    const file = "file" in info ? info.file : null;
    if (!(file instanceof TFile)) return;

    if (!this.isLiveListNote(file)) return;

    const currentContent = editor.getValue();
    const previousContent = this._contentCache.get(file.path) ?? currentContent;
    this._contentCache.set(file.path, currentContent);

    if (currentContent === previousContent) return;

    const currentLines = currentContent.split("\n");
    const previousLines = previousContent.split("\n");

    const toggled = this.findCheckboxToggle(previousLines, currentLines);

    if (toggled) {
      this.log(`checkbox toggle on line ${toggled.line}: nowChecked=${toggled.nowChecked}`);
      this.handleToggle(editor, file, toggled, currentLines);
      return;
    }

    // No toggle — detect structural list changes (item added/removed/reordered)
    // to keep stored positions in sync with user edits.
    const changedLine = this.firstChangedLine(previousLines, currentLines);
    if (changedLine === -1) return;

    const currBoundaries = findListBoundaries(currentLines, changedLine);
    if (!currBoundaries) return;

    const prevBoundaries = findListBoundaries(previousLines, changedLine);
    const currBlocks = parseListBlocks(
      currentLines.slice(currBoundaries.start, currBoundaries.end + 1)
    );
    const prevCount = prevBoundaries
      ? parseListBlocks(
          previousLines.slice(prevBoundaries.start, prevBoundaries.end + 1)
        ).length
      : 0;

    if (currBlocks.length !== prevCount) {
      this.log(`list item count changed ${prevCount}→${currBlocks.length}, refreshing positions`);
      this.pluginData = refreshPositions(currBlocks, file.path, this.pluginData, Date.now());
      this.saveSettings();
    }
  }

  private handleToggle(
    editor: Editor,
    file: TFile,
    toggled: { line: number; nowChecked: boolean },
    currentLines: string[]
  ): void {
    const { line: toggledLine, nowChecked } = toggled;
    const boundaries = findListBoundaries(currentLines, toggledLine);
    if (!boundaries) {
      this.log("could not find list boundaries around line", toggledLine);
      return;
    }
    this.log(`list boundaries: lines ${boundaries.start}–${boundaries.end}`);

    const listLines = currentLines.slice(boundaries.start, boundaries.end + 1);
    const blocks = parseListBlocks(listLines);
    this.log(`parsed ${blocks.length} block(s):`, blocks.map((b) => `"${b.text}" checked=${b.isChecked}`));

    const hasChecked = blocks.some((b) => b.isChecked);
    const hasUnchecked = blocks.some((b) => !b.isChecked);
    if (!hasChecked || !hasUnchecked) {
      this.log("list is all-checked or all-unchecked — refreshing positions only");
      this.pluginData = refreshPositions(blocks, file.path, this.pluginData, Date.now());
      this.saveSettings();
      return;
    }

    const relativeToggled = toggledLine - boundaries.start;
    const toggledKey =
      blocks.find((b) => b.startLine === relativeToggled)?.text.toLowerCase() ?? null;
    this.log("toggled item key:", toggledKey);

    const now = Date.now();
    const { sortedLines, updatedPluginData } = sortBlocks(
      blocks,
      file.path,
      this.pluginData,
      toggledKey,
      nowChecked,
      now
    );
    this.pluginData = updatedPluginData;

    if (sortedLines.join("\n") === listLines.join("\n")) {
      this.log("list already in correct order, no transaction needed");
      return;
    }

    this.log("applying sort transaction");
    this.applyTransaction(editor, boundaries, sortedLines, currentLines, file.path);
    this.saveSettings();
  }

  private applyTransaction(
    editor: Editor,
    boundaries: { start: number; end: number },
    sortedLines: string[],
    currentLines: string[],
    filePath: string
  ): void {
    this._isSorting = true;
    editor.transaction({
      changes: [
        {
          from: { line: boundaries.start, ch: 0 },
          to: { line: boundaries.end, ch: currentLines[boundaries.end].length },
          text: sortedLines.join("\n"),
        },
      ],
    });
    setTimeout(() => {
      this._isSorting = false;
      this._contentCache.set(filePath, editor.getValue());
    }, 0);
  }

  private findCheckboxToggle(
    prevLines: string[],
    currLines: string[]
  ): { line: number; nowChecked: boolean } | null {
    const maxLen = Math.max(prevLines.length, currLines.length);
    for (let i = 0; i < maxLen; i++) {
      const prev = prevLines[i] ?? "";
      const curr = currLines[i] ?? "";
      if (prev === curr) continue;

      const wasUnchecked = /^\s*- \[ \]/.test(prev);
      const isNowChecked = /^\s*- \[[xX]\]/.test(curr);
      const wasChecked = /^\s*- \[[xX]\]/.test(prev);
      const isNowUnchecked = /^\s*- \[ \]/.test(curr);

      if (wasUnchecked && isNowChecked) return { line: i, nowChecked: true };
      if (wasChecked && isNowUnchecked) return { line: i, nowChecked: false };
    }
    return null;
  }

  private firstChangedLine(prev: string[], curr: string[]): number {
    const max = Math.max(prev.length, curr.length);
    for (let i = 0; i < max; i++) {
      if ((prev[i] ?? "") !== (curr[i] ?? "")) return i;
    }
    return -1;
  }
}
