# 3D avatar model

Drop your model here, e.g. `agent/models/jayson.glb` (or `.vrm`), then set it in `index.html`:

```html
<script>window.AGENT_CONFIG={apiUrl:"...", avatarModel:"agent/models/jayson.glb"};</script>
```

Optional tuning keys: `avatarExtent` (zoom), `avatarLookDown`, `avatarRotateY`.
If the model fails to load, the page keeps the 2D SVG face.

## Requirements
- `.glb`/`.gltf` or `.vrm`, head and shoulders (or full body; the camera frames the head).
- For lip-sync/expressions: ARKit 52 blendshapes (e.g. `jawOpen`, `mouthSmileLeft`, `eyeBlinkLeft`), Oculus visemes, or VRM expressions. Without morphs it still sways and blinks, but the mouth will not move.
- Keep it under ~8-15 MB.

## Shrinking
Only shrink textures. Mesh compression/quantize/prune broke the face mesh in testing.

```bash
npx --yes @gltf-transform/cli resize in.glb tmp.glb --width 1024 --height 1024
```

```bash
npx --yes @gltf-transform/cli webp tmp.glb jayson.glb
```

## Privacy
Anything in this folder becomes public once pushed to GitHub Pages.
