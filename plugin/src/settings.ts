import { App, PluginSettingTab, Setting } from "obsidian";
import type OllamaRuntimePlugin from "./main";

export interface OllamaPluginSettings {
  runtimeUrl: string;
  defaultModel: string;
}

export const DEFAULT_SETTINGS: OllamaPluginSettings = {
  runtimeUrl: "http://127.0.0.1:8000",
  defaultModel: "mistral:latest",
};

export class OllamaSettingTab extends PluginSettingTab {
  plugin: OllamaRuntimePlugin;

  constructor(app: App, plugin: OllamaRuntimePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Ollama Runtime Settings" });

    new Setting(containerEl)
      .setName("Runtime URL")
      .setDesc("Base URL for the local Python runtime service.")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:8000")
          .setValue(this.plugin.settings.runtimeUrl)
          .onChange(async (value) => {
            this.plugin.settings.runtimeUrl =
              value.trim() || DEFAULT_SETTINGS.runtimeUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default model")
      .setDesc("Model name the plugin should use by default.")
      .addText((text) =>
        text
          .setPlaceholder("mistral:latest")
          .setValue(this.plugin.settings.defaultModel)
          .onChange(async (value) => {
            this.plugin.settings.defaultModel =
              value.trim() || DEFAULT_SETTINGS.defaultModel;
            await this.plugin.saveSettings();
          }),
      );
  }
}
