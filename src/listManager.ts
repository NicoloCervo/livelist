import type { ItemRecord, ListBlock, PluginData } from "./types";

const CHECKBOX_RE = /^(\s*)- \[[ xX]\]/;
const CHECKED_RE = /^(\s*)- \[[xX]\]/;
const UUID_RE = /<!--\s*ll:([a-f0-9]{4})\s*-->/;
const UUID_INJECT_RE = /\s*<!--\s*ll:[a-f0-9]{4}\s*-->/g;

export function isCheckboxLine(line: string): boolean {
  return CHECKBOX_RE.test(line);
}

export function isChecked(line: string): boolean {
  return CHECKED_RE.test(line);
}

export function extractUuid(line: string): string | null {
  const m = UUID_RE.exec(line);
  return m ? `ll:${m[1]}` : null;
}

export function injectUuid(line: string): string {
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `${line} <!-- ll:${hex} -->`;
}

export function stripUuid(line: string): string {
  return line.replace(UUID_INJECT_RE, "").trimEnd();
}

export function itemText(line: string): string {
  return stripUuid(line)
    .replace(/^\s*- \[[ xX]\]\s*/, "")
    .trim();
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
      uuid: extractUuid(topLine),
      text: itemText(topLine),
      startLine: i - blockLines.length,
    });
  }

  return blocks;
}

export function ensureUuids(blocks: ListBlock[]): { blocks: ListBlock[]; injected: boolean } {
  let injected = false;
  const updated = blocks.map((block) => {
    if (block.uuid !== null) return block;
    const newTopLine = injectUuid(block.lines[0]);
    const newUuid = extractUuid(newTopLine)!;
    injected = true;
    return {
      ...block,
      lines: [newTopLine, ...block.lines.slice(1)],
      uuid: newUuid,
    };
  });
  return { blocks: updated, injected };
}

export function sortBlocks(
  blocks: ListBlock[],
  filePath: string,
  pluginData: PluginData,
  toggledUuid: string | null,
  nowChecked: boolean,
  now: number
): { sortedLines: string[]; updatedPluginData: PluginData } {
  const fileItems = { ...(pluginData.items[filePath] ?? {}) };

  // Ensure all blocks have records; create missing ones first
  for (const block of blocks) {
    if (!block.uuid) continue;
    if (!fileItems[block.uuid]) {
      fileItems[block.uuid] = {
        originalIndex: -1,
        text: block.text,
        createdAt: now,
        checkCount: 0,
      };
    } else {
      fileItems[block.uuid] = { ...fileItems[block.uuid], text: block.text };
    }
  }

  // Update metadata for toggled item (record is guaranteed to exist now)
  if (toggledUuid && fileItems[toggledUuid]) {
    const existing = fileItems[toggledUuid];
    if (nowChecked) {
      fileItems[toggledUuid] = {
        ...existing,
        checkedAt: now,
        checkCount: existing.checkCount + 1,
      };
    } else {
      fileItems[toggledUuid] = { ...existing, uncheckedAt: now };
    }
  }

  const unchecked = blocks.filter((b) => !b.isChecked);
  const checked = blocks.filter((b) => b.isChecked);

  // Sort unchecked by stored originalIndex; unknown (-1) go to end
  const sortedUnchecked = [...unchecked].sort((a, b) => {
    const ai = a.uuid ? (fileItems[a.uuid]?.originalIndex ?? -1) : -1;
    const bi = b.uuid ? (fileItems[b.uuid]?.originalIndex ?? -1) : -1;
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Refresh originalIndex for unchecked items after sort
  sortedUnchecked.forEach((block, idx) => {
    if (block.uuid && fileItems[block.uuid]) {
      fileItems[block.uuid] = { ...fileItems[block.uuid], originalIndex: idx };
    }
  });

  // Prune stale UUIDs for this file
  const currentUuids = new Set(blocks.map((b) => b.uuid).filter(Boolean));
  for (const uuid of Object.keys(fileItems)) {
    if (!currentUuids.has(uuid)) {
      delete fileItems[uuid];
    }
  }

  const updatedPluginData: PluginData = {
    ...pluginData,
    items: { ...pluginData.items, [filePath]: fileItems },
  };

  const sortedLines = [
    ...sortedUnchecked.flatMap((b) => b.lines),
    ...checked.flatMap((b) => b.lines),
  ];

  return { sortedLines, updatedPluginData };
}
