# Setu (the bridge): source of the Rive file

The picture shown while a literature scan runs: a bridge whose planks are laid as the themes finish. The design is in [docs/design/setu-rive.md](../../../../docs/design/setu-rive.md).

`gen.py` writes `scene.rml` (RML, the Rive CLI's text format): one artboard for each number of themes, `Setu2` to `Setu6`, and one view model `Setu`. The scene is generated, not hand-written,
so the five artboards stay the same and a change of look is a change of a number at the top of the script. The Rive CLI builds it into a `.riv` (nothing is signed or uploaded).

```bash
python gen.py > scene.rml                      # --bg RRGGBB paints a background, for screenshots only; the shipped file has none
rive . --verify                                # compiles: must say 0 errors, 0 warnings
rive inspect . --summary                       # "problems" must be []
rive . --once                                  # writes build/setu.riv (an unsigned file; it has no scripts, so web runtimes accept it)
rive . --screenshot=out.png --data=p1=3 --data=p2=3 --data=p3=4 --data=p4=3 --data=p5=2 --advance=1500ms     # a frame, headless
rive .                                         # the live window, for looking at it as you edit (stays open until closed)
```

## What the page tells it (the view model `Setu`)

| Property | Type | Meaning |
|---|---|---|
| `p1` to `p6` | number | the state of theme k: `0` waiting, `1` searching, `2` reading, `3` answered, `4` no paper (a gap) |
| `cross` | boolean | `true` when the scan ended with no gap: the question crosses the bridge |
| `line`, `accent`, `accentSoft`, `warn`, `ink` | colour | the page's own colours (`--border-strong`, `--accent`, `--accent-soft`, `--warn`, `--text`), set by the page so the three themes need no second file |

Pick the artboard with the number of themes (`Setu` + 2 to 6). The picture never decides anything: it shows a state the server has already stored.
