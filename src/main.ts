import { Editor, MarkdownFileInfo, MarkdownView, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, LiveListSettings, PluginData } from "./types";
import { LiveListSettingTab } from "./settings";
import {
  ensureUuids,
  findListBoundaries,
  parseListBlocks,
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
        });
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        if (this.pluginData.items[file.path]) {
          delete this.pluginData.items[file.path];
          this.saveSettings();
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
        }
      })
    );
  }

  async onunload(): Promise<void> {
    this._contentCache.clear();
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
    if (!toggled) return;

    const { line: toggledLine, nowChecked } = toggled;
    const boundaries = findListBoundaries(currentLines, toggledLine);
    if (!boundaries) return;

    const listLines = currentLines.slice(boundaries.start, boundaries.end + 1);
    let blocks = parseListBlocks(listLines);

    const hasChecked = blocks.some((b) => b.isChecked);
    const hasUnchecked = blocks.some((b) => !b.isChecked);
    if (!hasChecked || !hasUnchecked) {
      // Still need to inject UUIDs for new items, but no sorting needed
      const { blocks: withUuids, injected } = ensureUuids(blocks);
      if (injected) {
        this.applyTransaction(editor, boundaries, withUuids.flatMap((b) => b.lines), currentLines, file.path);
      }
      return;
    }

    const { blocks: withUuids, injected: uuidsInjected } = ensureUuids(blocks);
    blocks = withUuids;

    // Find UUID of toggled item
    const toggledBlock = blocks.find((b) => {
      const topIndent = b.lines[0].length - b.lines[0].trimStart().length;
      const toggledIndent = currentLines[toggledLine].length - currentLines[toggledLine].trimStart().length;
      return topIndent === toggledIndent && b.lines[0].includes(currentLines[toggledLine].replace(/\s*<!--.*?-->\s*$/, "").trim().replace(/- \[[ xX]\]/, "").trim());
    });
    const toggledUuid = toggledBlock?.uuid ?? null;

    const now = Date.now();
    const { sortedLines, updatedPluginData } = sortBlocks(
      blocks,
      file.path,
      this.pluginData,
      toggledUuid,
      nowChecked,
      now
    );
    this.pluginData = updatedPluginData;

    const newListText = sortedLines.join("\n");
    const oldListText = listLines.join("\n");
    if (newListText === oldListText && !uuidsInjected) return;

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
}
