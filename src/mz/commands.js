import { PLUGIN_NAME } from "../config.js";
import { fadeAmbient, resetAmbient, resolveAmbient } from "../core/ambient.js";
import { readBoolean, readNumber, readString } from "../core/params.js";
import { warnOnce } from "./warn.js";

// Plugin commands. Arguments arrive as strings from the editor; the handler
// runs with `this` set to the event interpreter.
export function installCommands(settings) {
    const frames = (raw) => readNumber(raw, 60, { min: 0, max: 36000 });

    function finish(interpreter, args) {
        if (readBoolean(args.wait, false)) interpreter.wait(frames(args.duration));
    }

    function readAmbientArg(args, commandName) {
        const warn = (msg) => warnOnce(`${commandName} on map ${$gameMap.mapId()}: ${msg}`);
        const color = resolveAmbient(args.color, settings.ambientPresets, warn);
        if (!color && !readString(args.color, "")) warn("no color or preset given");
        return color;
    }

    PluginManager.registerCommand(PLUGIN_NAME, "setGlobalLight", function(args) {
        const color = readAmbientArg(args, "Set Global Light");
        if (!color) return;
        fadeAmbient($gameSystem.ghGlobalLight(), color, frames(args.duration));
        finish(this, args);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "setAmbient", function(args) {
        const color = readAmbientArg(args, "Set Map Ambient");
        if (!color) return;
        fadeAmbient($gameMap.ghAmbient(), color, frames(args.duration));
        finish(this, args);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "resetAmbient", function(args) {
        resetAmbient($gameMap.ghAmbient(), frames(args.duration), $gameSystem.ghGlobalLight().color);
        finish(this, args);
    });

    // A blank light clears the override, giving control back to notetags.
    const lightArg = (raw) => readString(raw, "") || undefined;

    PluginManager.registerCommand(PLUGIN_NAME, "setEventLight", function(args) {
        const id = readNumber(args.eventId, 0) || this.eventId();
        const event = $gameMap.event(id);
        if (event) event.ghSetLight(lightArg(args.light));
        else warnOnce(`Set Event Light on map ${$gameMap.mapId()}: there is no event ${id}`);
    });

    PluginManager.registerCommand(PLUGIN_NAME, "setPlayerLight", function(args) {
        $gamePlayer.ghSetLight(lightArg(args.light));
    });
}
