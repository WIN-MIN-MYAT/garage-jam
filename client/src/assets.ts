import { AssetType, defineAssets } from '@iwsdk/core';
import { createGarageShell } from './scene-assets/garage.scene-asset.js';
const url = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
export default defineAssets({
  'garage-shell': createGarageShell(),
  'garage-hud': { url: url('ui/garage-hud.uikitml'), type: AssetType.UIKitML, name: 'Garage HUD' },
});
