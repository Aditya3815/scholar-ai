# Rive sources

Pictures drawn by Rive files (docs/design/setu-rive.md, rive-ideas.md). Each folder has a generator (`gen.py`) that writes `scene.rml`, the text the Rive CLI builds into a `.riv`; the built files the app uses are committed in
`src/assets/rive/` because the CLI is not in CI.

| Folder | The picture | In the app |
|---|---|---|
| `setu` | the bridge laid while a literature scan runs | `components/litscan/Setu.tsx` |
| `reading` | the scene beside an upload | `components/papers/Reading.tsx` |
| `drop` | the box in the upload zone | `components/papers/DropBox.tsx` |
| `icons` | a research prototype of icons with hover, press and toggle; **not used** (the app's icons are CSS: docs/design/icon-motion.md) | none |

To change one: edit its `gen.py`, then in that folder

```bash
python gen.py > scene.rml
rive . --verify          # 0 errors, 0 warnings
rive inspect . --summary # "problems" must be []
rive . --once            # writes build/<name>.riv
cp build/<name>.riv ../../src/assets/rive/<name>.riv
```

`python gen.py --bg RRGGBB > scene.rml` paints a background so that `rive . --screenshot=out.png --data=... --advance=...` shows the picture on the page's colour (the shipped files have none).
The CLI's `--data=name=value` writes a property of the file's view model, so every state can be looked at without a window.
