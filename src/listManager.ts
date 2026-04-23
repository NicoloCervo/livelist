import type { ListBlock, PluginData } from "./types";

const CHECKBOX_RE = /^(\s*)- \[[ xX]\]/;
const CHECKED_RE = /^(\s*)- \[[xX]\]/;

export function isCheckboxLine(line: string): boolean {
  return CHECKBOX_RE.test(line);
}

export function isChecked(line: string): boolean {
  return CHECKED_RE.test(line);
}

export function itemText(line: string): string {
  return line.replace(/^\s*- \[[ xX]\]\s*/, "").trim();
}

export function itemKey(line: string): string {
  return itemText(line).toLowerCase();
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

export function findListBoundaries(
  lines: string[],
  changedLine: number
): { start: number; end: number } | null {
  if (!isCheckboxLine(lines[changedLine]) && !isInList(lines, changedLine)) {
    return null;
  }

  let start = changedLine;
  while (start > 0) {
    const prev = lines[start - 1];
    if (prev.trim() === "") break;
    if (!isCheckboxLine(prev) && !isContinuation(lines, start - 1)) break;
    start--;
  }

  let end = changedLine;
  while (end < lines.length - 1) {
    const next = lines[end + 1];
    if (next.trim() === "") break;
    if (!isCheckboxLine(next) && !isContinuation(lines, end + 1)) break;
    end++;
  }

  if (!rangeHasCheckbox(lines, start, end)) return null;
  return { start, end };
}

function isInList(lines: string[], lineNum: number): boolean {
  for (let i = lineNum - 1; i >= 0; i--) {
    if (lines[i].trim() === "") return false;
    if (isCheckboxLine(lines[i])) return true;
  }
  return false;
}

function isContinuation(lines: string[], lineNum: number): boolean {
  if (lineNum <= 0) return false;
  if (!isCheckboxLine(lines[lineNum]) && lines[lineNum].trim() !== "") {
    const prevCheckbox = findPrevCheckbox(lines, lineNum);
    if (prevCheckbox === -1) return false;
    return indentOf(lines[lineNum]) > indentOf(lines[prevCheckbox]);
  }
  return false;
}

function findPrevCheckbox(lines: string[], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (lines[i].trim() === "") return -1;
    if (isCheckboxLine(lines[i])) return i;
  }
  return -1;
}

function rangeHasCheckbox(lines: string[], start: number, end: number): boolean {
  for (let i = start; i <= end; i++) {
    if (isCheckboxLine(lines[i])) return true;
  }
  return false;
}

export function parseListBlocks(lines: string[]): ListBlock[] {
  const blocks: ListBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isCheckboxLine(lines[i])) {
      i++;
      continue;
    }

    const topLine = lines[i];
    const topIndent = indentOf(topLine);
    const blockLines: string[] = [topLine];
    i++;

    while (i < lines.length) {
      const cur = lines[i];
      if (cur.trim() === "") break;
      if (isCheckboxLine(cur) && indentOf(cur) <= topIndent) break;
      if (!isCheckboxLine(cur) && indentOf(cur) <= topIndent) break;
      blockLines.push(cur);
      i++;
    }

    blocks.push({
      lines: blockLines,
      isChecked: isChecked(topLine),
      text: itemText(topLine),
      startLine: i - blockLines.length,
    });
  }

  return blocks;
}

export function sortBlocks(
  blocks: ListBlock[],
  filePath: string,
  pluginData: PluginData,
  toggledKey: string | null,
  nowChecked: boolean,
  now: number
): { sortedLines: string[]; updatedPluginData: PluginData } {
  const fileItems = { ...(pluginData.items[filePath] ?? {}) };

  // Ensure all blocks have records first
  for (const block of blocks) {
    const key = block.text.toLowerCase();
    if (!fileItems[key]) {
      fileItems[key] = {
        originalIndex: -1,
        text: block.text,
        createdAt: now,
        checkCount: 0,
      };
    } else {
      fileItems[key] = { ...fileItems[key], text: block.text };
    }
  }

  // Update metadata for toggled item (record guaranteed to exist now)
  if (toggledKey && fileItems[toggledKey]) {
    const existing = fileItems[toggledKey];
    if (nowChecked) {
      fileItems[toggledKey] = {
        ...existing,
        checkedAt: now,
        checkCount: existing.checkCount + 1,
      };
    } else {
      fileItems[toggledKey] = { ...existing, uncheckedAt: now };
    }
  }

  const unchecked = blocks.filter((b) => !b.isChecked);
  const checked = blocks.filter((b) => b.isChecked);

  // Sort unchecked by stored originalIndex; unknown (-1) go to end
  const sortedUnchecked = [...unchecked].sort((a, b) => {
    const ai = fileItems[a.text.toLowerCase()]?.originalIndex ?? -1;
    const bi = fileItems[b.text.toLowerCase()]?.originalIndex ?? -1;
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Refresh originalIndex after sort
  sortedUnchecked.forEach((block, idx) => {
    const key = block.text.toLowerCase();
    if (fileItems[key]) {
      fileItems[key] = { ...fileItems[key], originalIndex: idx };
    }
  });

  // Prune stale keys
  const currentKeys = new Set(blocks.map((b) => b.text.toLowerCase()));
  for (const key of Object.keys(fileItems)) {
    if (!currentKeys.has(key)) delete fileItems[key];
  }

  return {
    sortedLines: [
      ...sortedUnchecked.flatMap((b) => b.lines),
      ...checked.flatMap((b) => b.lines),
    ],
    updatedPluginData: {
      ...pluginData,
      items: { ...pluginData.items, [filePath]: fileItems },
    },
  };
}

// Updates stored originalIndex values to reflect the current item order.
// Called when items are added, removed, or manually reordered (no checkbox toggle).
export function refreshPositions(
  blocks: ListBlock[],
  filePath: string,
  pluginData: PluginData,
  now: number
): PluginData {
  const fileItems = { ...(pluginData.items[filePath] ?? {}) };

  for (const block of blocks) {
    const key = block.text.toLowerCase();
    if (!fileItems[key]) {
      fileItems[key] = {
        originalIndex: -1,
        text: block.text,
        createdAt: now,
        checkCount: 0,
      };
    } else {
      fileItems[key] = { ...fileItems[key], text: block.text };
    }
  }

  const unchecked = blocks.filter((b) => !b.isChecked);
  unchecked.forEach((block, idx) => {
    const key = block.text.toLowerCase();
    fileItems[key] = { ...fileItems[key], originalIndex: idx };
  });

  // Prune stale keys
  const currentKeys = new Set(blocks.map((b) => b.text.toLowerCase()));
  for (const key of Object.keys(fileItems)) {
    if (!currentKeys.has(key)) delete fileItems[key];
  }

  return {
    ...pluginData,
    items: { ...pluginData.items, [filePath]: fileItems },
  };
}
