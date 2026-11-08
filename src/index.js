import { PLUGIN_NAME } from "./config.js";
import { installCommands } from "./mz/commands.js";
import { installSpritesetHooks } from "./mz/spriteset.js";
import { installStateHooks } from "./mz/state.js";
import { installSurfaceHooks } from "./mz/surfaces.js";
import { warnOnce } from "./mz/warn.js";
import { parseSettings } from "./settings.js";

const settings = parseSettings(PluginManager.parameters(PLUGIN_NAME), (msg) => warnOnce(`Plugin parameters: ${msg}`));
installStateHooks(settings);
installCommands(settings);
installSpritesetHooks(settings);
installSurfaceHooks(settings);

// Entry point for script calls and other plugins. Anything added here becomes
// API that people's events will depend on, so keep it small.
window[PLUGIN_NAME] = Object.freeze({
    version: __VERSION__,
    settings,
});
