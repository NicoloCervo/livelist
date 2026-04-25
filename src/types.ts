export interface LiveListSettings {
  autoSort: boolean;
  debugLogging: boolean;
  verboseLogging: boolean;
}

export const DEFAULT_SETTINGS: LiveListSettings = {
  autoSort: true,
  debugLogging: false,
  verboseLogging: false,
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
  text: string;
  startLine: number; // relative to the slice passed to parseListBlocks
}
