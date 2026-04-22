export interface LiveListSettings {
  autoSort: boolean;
}

export const DEFAULT_SETTINGS: LiveListSettings = {
  autoSort: true,
};

export interface ItemRecord {
  originalIndex: number;
  text: string;
  createdAt: number;
  checkedAt?: number;
  uncheckedAt?: number;
  checkCount: number;
}

export interface PluginData {
  settings: LiveListSettings;
  items: Record<string, Record<string, ItemRecord>>;
}

export interface ListBlock {
  lines: string[];
  isChecked: boolean;
  uuid: string | null;
  text: string;
  startLine: number; // relative to the slice passed to parseListBlocks
}
