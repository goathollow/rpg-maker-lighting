import { SURFACE_FOLDERS } from "../core/surfaces.js";
import { isSurfaceListingLoaded, loadSurfaceListing } from "./surfaceFiles.js";
import { surfaceImageFor, surfaceImagesReady } from "./SurfaceImages.js";

// Starts finding the game's normal and AO maps as soon as the plugin loads,
// and holds the boot scene until that is done, so the first map already
// knows them. Each image's maps then load along with it, and a map scene
// starts once they have, so nothing pops in.
export function installSurfaceHooks(settings) {
    loadSurfaceListing(settings.surfaceMaps);

    const isBootReady = Scene_Boot.prototype.isReady;
    Scene_Boot.prototype.isReady = function() {
        return isBootReady.call(this) && isSurfaceListingLoaded();
    };

    if (!settings.surfaceMaps) return;
    const litFolders = new Map(SURFACE_FOLDERS.map((folder) => [`img/${folder}/`, folder]));
    const loadBitmap = ImageManager.loadBitmap;
    ImageManager.loadBitmap = function(folder, filename) {
        const bitmap = loadBitmap.call(this, folder, filename);
        if (filename && litFolders.has(folder)) surfaceImageFor(litFolders.get(folder), filename);
        return bitmap;
    };

    const isMapReady = Scene_Map.prototype.isReady;
    Scene_Map.prototype.isReady = function() {
        return isMapReady.call(this) && surfaceImagesReady();
    };
}
