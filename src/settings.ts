import { App, PluginSettingTab, Setting } from "obsidian";
import type LiveListPlugin from "./main";

export class LiveListSettingTab extends PluginSettingTab {
  plugin: LiveListPlugin;

  constructor(app: App, plugin: LiveListPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "LiveList Settings" });

    new Setting(containerEl)
      .setName("Auto-sort checked items")
      .setDesc(
        "Automatically move checked items to the bottom of the list " +
          "and restore them when unchecked. Only affects notes tagged #livelist."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSort).onChange(async (value) => {
          this.plugin.settings.autoSort = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
