import streamDeck from "@elgato/streamdeck";

export type HaGraphSettings = {
  haUrl?: string;
  haToken?: string;
  entityId?: string;
  displayName?: string;
  reverseColors?: string;
  freezeScale?: string;
  unit?: string;
};

type GlobalSettings = {
  haUrl?: string;
  haToken?: string;
};

/** Resolve per-action settings with global fallback for haUrl and haToken */
export async function resolveSettings(settings: HaGraphSettings): Promise<HaGraphSettings> {
  if (settings.haUrl && settings.haToken) return settings;

  try {
    const global = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
    return {
      ...settings,
      haUrl: settings.haUrl || global.haUrl,
      haToken: settings.haToken || global.haToken,
    };
  } catch {
    return settings;
  }
}
