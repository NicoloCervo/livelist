# livelist
Obsidian plugin for smart shopping lists. Checked items automatically move to the bottom; uncheck them and they snap back to their original position. Nested sub-items travel with their parent.

Only activates on notes tagged `#livelist`.

## Installation

### Desktop (manual)

1. Download or build `main.js` and `manifest.json` from this repo.
2. In your vault, create the folder `.obsidian/plugins/livelist/`.
3. Copy `main.js` and `manifest.json` into that folder.
4. In Obsidian: **Settings → Community plugins → Installed plugins**, enable **LiveList**.

### Mobile (iOS / Android)

Obsidian mobile uses the same plugin system. The easiest way to get files onto your device is via a sync tool you already use (Obsidian Sync, iCloud, Dropbox, etc.):

1. On your desktop, copy `main.js` and `manifest.json` into `.obsidian/plugins/livelist/` inside your synced vault folder.
2. Let the sync complete on your mobile device.
3. In Obsidian mobile: **Settings → Community plugins**, toggle on **LiveList**.

If you don't use a sync service, you can transfer the two files manually over USB or AirDrop into the same `.obsidian/plugins/livelist/` path inside your vault.

> **Note:** Make sure *Community plugins* are enabled (Safe mode off) before trying to activate LiveList.

## Usage

1. Add the tag `#livelist` anywhere in a note (e.g. in the frontmatter or inline).
2. Write a Markdown checkbox list:
   ```
   - [ ] Bread
     - [ ] Sourdough
   - [ ] Milk
   - [ ] Eggs
   ```
3. Check an item — it moves to the bottom with its sub-items.
4. Uncheck it — it returns to its original position.

## Building from source

```bash
npm install
npm run build   # produces main.js
```
