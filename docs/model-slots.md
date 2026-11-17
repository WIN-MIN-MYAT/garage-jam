# Model replacement slots

Status: 2026-11-16. The room-driven build (`?roomBuild=1`) loads the `model` field from `assets/assets.config.json` for each placed prop, after spawning the placeholder. A failed load leaves the placeholder visible. The old fixed prototype (`?demo=1`) loads the same manifest through `SlotManager`.

## Currently assigned models

All of these GLBs live in `assets/models/optimized/`, were processed with meshopt/WebP, and are applied with the shared toon material.

| Build slot | Manifest key | Model file | Placement |
| --- | --- | --- | --- |
| `trash` | `SLOT_TrashCan` | `trash-can.glb` | floor |
| `paint-cans` | `SLOT_PaintCans` | `paint-cans.glb` | floor |
| `pegboard` | `SLOT_PegboardTools` | `tool-set.glb` | wall |
| `shelf` | `SLOT_Shelf` | `storage-shelf.glb` | floor |
| `lamp` | `SLOT_Lamp` | `industrial-light.glb` | ceiling |
| `neon` | `SLOT_NeonSign` | `neon-sign.glb` | wall |
| `shutter` | `SLOT_MetalShutter` | `metal-shutter.glb` | wall |
| workbench | `SLOT_Workbench` | `wooden-workbench.glb` | scanned table |
| crumpled paper | `SLOT_PaperCrumpled` | `crumpled-paper.glb` | task-paper path |

The new shutter slot (`shutter` / `SLOT_MetalShutter`) is a decorative side-wall shutter, not the sunset opening. The sunset garage opening remains a procedural cutout so the golden-hour view stays visible.

## Facing

The GLBs were checked in a front/back/side preview: their native front is **+Z**.

- Wall props use the wall normal, so the front faces into the room.
- Floor and table props rotate to face the seat.
- The workbench uses the table's **oriented outline**, not its world-axis bounding box. Its long side follows the table's long side, its yaw faces the seat, and its flat worktop face is scaled to the table width/depth. The model bounding box includes the vise above the worktop, so the loader detects the largest upward-facing horizontal face (native y ≈ 0.575 of a 0.65 m bbox), anchors that face to the table height, and centers that face on the table outline. The vise sits above and outside the worktop as expected.
- Ceiling props hang from the ceiling; the light is rotated toward the seat.
- Crumpled paper has no meaningful facing.

## Ready for future generated GLBs

These slots have placement rules, manifest entries and working model swaps.

| Build slot | Manifest key | Placement | Suggested file | Triangle budget |
| --- | --- | --- | --- | ---: |
| `crates` | `SLOT_Crates` | floor, DECOR | `crates.glb` | 3,000 |
| `tires` | `SLOT_TireStack` | floor, DECOR | `tires.glb` | 3,000 |
| `mini-fridge` | `SLOT_MiniFridge` | floor, DECOR | `mini-fridge.glb` | 3,000 |
| `toolbox` | `SLOT_Toolbox` | floor, DECOR | `toolbox.glb` | 3,000 |
| `stats-board` | `SLOT_StatsBoard` | wall, NEAR | `stats-board-frame.glb` | 2,000 |
| `calendar-board` | `SLOT_CalendarBoard` | wall, NEAR | `calendar-board-frame.glb` | 2,000 |
| `corkboard` | `SLOT_Corkboard` | wall, NEAR | `corkboard-frame.glb` | 2,000 |
| `whiteboard` | `SLOT_Whiteboard` | wall, NEAR | `whiteboard-frame.glb` | 2,000 |
| `patch-bay` | `SLOT_PatchBay` | wall, NEAR | `patch-bay.glb` | 2,000 |

Board replacements are for the physical frame/body only. Contents remain procedural UI/canvas content.

## Texture/decal, not a GLB

| Build slot | Manifest key | Why |
| --- | --- | --- |
| `graffiti` | `SLOT_GraffitiDecals` | Flat wall decal. Use a texture/atlas, not a Tripo model. |

## Manifest entries that exist but are not used by the new room build

| Manifest key | Status |
| --- | --- |
| `SLOT_GarageDoor` | The garage door is a cut wall opening plus frame and sky backdrop. The metal shutter uses its own `SLOT_MetalShutter` slot. |
| `SLOT_DoorHandle` | Focus-door interaction is not implemented yet. |
| `SLOT_MuralWall` | No `mural` placement rule/mapping yet. |
| `SLOT_Marker` | Whiteboard marker interaction is not implemented yet. |
| `SLOT_Chair` | There is intentionally no chair prop; the real chair stays real. |
| `SLOT_Backdrop` | The sky enclosure/backdrop is procedural. |

## Swap procedure

1. Put the untouched GLB in `assets/models/raw/`.
2. Optimize it to `assets/models/optimized/`:

```powershell
npm run model:optimize -- assets/models/raw/trash-can.glb assets/models/optimized/trash-can.glb --compress meshopt --texture-compress webp --texture-size 1024
```

3. Set the `model` field in `assets/assets.config.json`.
4. Reload `/?roomBuild=1` (or `/?roomBuild=1&roomSource=demo` for a quick room). The slot must be placed for the model to appear; check the HUD's unplaced list.

The loader scales the model to `targetSize`, re-pivots it, applies the shared comic/toon material and outline, and uses the model's native +Z front. The room-driven path currently has no prop physics colliders.
