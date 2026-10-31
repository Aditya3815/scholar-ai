#!/usr/bin/env python3
"""Generates scene.rml for the "reading" scene: a paper being read while it is uploaded, indexed or (for page pictures) read page by page. One artboard, 96 x 96.

View model `Reading` (what the page writes; the file decides nothing):
  mode      number  0 the PDF is being read in the browser, 1 uploaded, 2 indexed or its pages read, 3 done, 4 paused
  progress  number  how far along the whole job is, 0 to 1 (the ring; it is eased over 0.45 s so that it creeps instead of jumping)
  line, accent, accentSoft  colour  the page's own tokens

Usage: python gen.py [--bg RRGGBB] > scene.rml     (--bg paints a background, for screenshots only; the shipped file has none)
"""
import math, sys

BG = sys.argv[sys.argv.index("--bg") + 1].upper() if "--bg" in sys.argv else None
SIZE, C = 96, 48
SHEET_W, SHEET_H = 40, 52
MODES = ["read", "upload", "index", "done", "paused"]

_n = [0]
def nid():
    _n[0] += 1
    return f"0:{_n[0]}"

out = []
def w(s="", i=0):
    out.append("    " * i + s)

VM, INST, CONV = nid(), nid(), nid()
P = {k: nid() for k in ("mode", "progress", "line", "accent", "accentSoft")}
COL = {"line": "FFCFC9BB", "accent": "FF3548C8", "accentSoft": "FFE8EBFA"}

def solid(name, i):
    w(f'<SolidColor colorValue="{COL[name]}" name="{name}">', i)
    w(f'<DataBindContext sourcePathIds="{VM}-{P[name]}" propertyKey="37"/>', i + 1)
    w("</SolidColor>", i)

def cond_mode(k):
    return (f'<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyNumber>'
            f'<DataBindContext sourcePathIds="{VM}-{P["mode"]}" propertyKey="636"/></BindablePropertyNumber></TransitionPropertyViewModelComparator>'
            f'<TransitionValueNumberComparator value="{k}"/></TransitionViewModelCondition>')

def keyed(obj, props):
    s = f'<KeyedObject objectId="{obj}">'
    for prop, frames in props.items():
        s += f'<KeyedProperty property="{prop}">'
        for fr, v, interp in frames:
            s += f'<KeyFrameDouble value="{v}" interpolationType="{interp}"' + (f' frame="{fr}"' if fr else "") + "/>"
        s += "</KeyedProperty>"
    return s + "</KeyedObject>"

def build():
    ab, sm, style = nid(), nid(), nid()
    ids = {k: nid() for k in ("g", "top", "scan", "turn", "check", "pulse", "ring_trim", "ring_group", "check_trim", "check_group")}
    w(f'<Artboard defaultStateMachineId="{sm}" styleId="{style}" viewModelId="{VM}" viewModelInstanceId="{INST}" x="0" y="0" width="{SIZE}" height="{SIZE}" name="Reading" id="{ab}">', 1)
    w(f'<LayoutComponentStyle name="Artboard Style" id="{style}"/>', 2)
    if BG:
        w(f'<Fill name="Background"><SolidColor colorValue="FF{BG}" name="Bg"/></Fill>', 2)

    # effects: the ring's trim follows `progress`; the check is drawn by its own trim
    w(f'<GroupEffect name="Ring" id="{ids["ring_group"]}">', 2)
    w(f'<TrimPath start="0" end="0" name="Trim" id="{ids["ring_trim"]}">', 3)
    w(f'<DataBindContext sourcePathIds="{VM}-{P["progress"]}" propertyKey="115" converterId="{CONV}"/>', 4)
    w("</TrimPath>", 3); w("</GroupEffect>", 2)
    w(f'<GroupEffect name="Check" id="{ids["check_group"]}"><TrimPath start="0" end="0" name="Trim" id="{ids["check_trim"]}"/></GroupEffect>', 2)

    # on top: the check, then the paper that is being read, then the page that is set aside, then the pile
    w(f'<Shape x="{C}" y="{C + 3}" opacity="1" name="Check" id="{ids["check"]}">', 2)
    w('<PointsPath name="Path">', 3)
    for x, y in ((-10, 0), (-3, 7), (11, -7)):
        w(f'<StraightVertex x="{x}" y="{y}"/>', 4)
    w("</PointsPath>", 3)
    w('<Stroke thickness="5" cap="round" join="round" name="Stroke">', 3); solid("accent", 4)
    w(f'<TargetEffect targetId="{ids["check_group"]}" name="Use Check"/>', 4); w("</Stroke>", 3); w("</Shape>", 2)

    w(f'<Node x="{C}" y="{C}" name="Pile" id="{ids["g"]}">', 2)
    w(f'<Node name="Paper" id="{ids["top"]}">', 3)
    w(f'<Shape y="-22" opacity="0" name="Scan line" id="{ids["scan"]}">', 4)
    w(f'<Rectangle originX="0.5" originY="0.5" width="{SHEET_W}" height="2.5" cornerRadiusTL="1" name="Path"/>', 5)
    w('<Fill name="Fill">', 5); solid("accent", 6); w("</Fill>", 5); w("</Shape>", 4)
    for k, (y, width) in enumerate(((-13, 26), (-4, 26), (5, 18))):
        w(f'<Shape y="{y}" opacity="0.4" name="Line {k + 1}">', 4)
        w(f'<Rectangle originX="0.5" originY="0.5" width="{width}" height="3.5" cornerRadiusTL="1.75" name="Path"/>', 5)
        w('<Fill name="Fill">', 5); solid("accent", 6); w("</Fill>", 5); w("</Shape>", 4)
    w('<Shape name="Sheet">', 4)
    w(f'<Rectangle originX="0.5" originY="0.5" width="{SHEET_W}" height="{SHEET_H}" cornerRadiusTL="5" name="Path"/>', 5)
    w('<Fill name="Fill">', 5); solid("accentSoft", 6); w("</Fill>", 5)
    w('<Stroke thickness="2" name="Stroke">', 5); solid("accent", 6); w("</Stroke>", 5); w("</Shape>", 4)
    w("</Node>", 3)
    # the page that is set aside each time one is read (drawn above the pile, below the paper)
    w(f'<Shape opacity="0" name="Page set aside" id="{ids["turn"]}">', 3)
    w(f'<Rectangle originX="0.5" originY="0.5" width="{SHEET_W}" height="{SHEET_H}" cornerRadiusTL="5" name="Path"/>', 4)
    w('<Fill name="Fill">', 4); solid("accentSoft", 5); w("</Fill>", 4)
    w('<Stroke thickness="2" name="Stroke">', 4); solid("accent", 5); w("</Stroke>", 4); w("</Shape>", 3)
    for k, (dx, dy, rot) in enumerate(((7, -3, 0.11), (4, -1.5, 0.055))):
        w(f'<Shape x="{dx}" y="{dy}" rotation="{rot}" name="Pile {k + 1}">', 3)
        w(f'<Rectangle originX="0.5" originY="0.5" width="{SHEET_W}" height="{SHEET_H}" cornerRadiusTL="5" name="Path"/>', 4)
        w('<Stroke thickness="2" name="Stroke">', 4); solid("line", 5); w("</Stroke>", 4); w("</Shape>", 3)
    w("</Node>", 2)

    # the ring: a track, the fill (starts at the top), and a pulse that answers when it is done
    w(f'<Shape x="{C}" y="{C}" opacity="0" name="Pulse" id="{ids["pulse"]}">', 2)
    w('<Ellipse originX="0.5" originY="0.5" width="86" height="86" name="Path"/>', 3)
    w('<Stroke thickness="3" name="Stroke">', 3); solid("accent", 4); w("</Stroke>", 3); w("</Shape>", 2)
    w(f'<Shape x="{C}" y="{C}" name="Ring">', 2)   # an ellipse path already starts at the top and runs clockwise
    w('<Ellipse originX="0.5" originY="0.5" width="86" height="86" name="Path"/>', 3)
    w('<Stroke thickness="4" cap="round" name="Stroke">', 3); solid("accent", 4)
    w(f'<TargetEffect targetId="{ids["ring_group"]}" name="Use Ring"/>', 4); w("</Stroke>", 3); w("</Shape>", 2)
    w(f'<Shape x="{C}" y="{C}" name="Track">', 2)
    w('<Ellipse originX="0.5" originY="0.5" width="86" height="86" name="Path"/>', 3)
    w('<Stroke thickness="4" name="Stroke">', 3); solid("line", 4); w("</Stroke>", 3); w("</Shape>", 2)

    # the machine: one layer, five modes, a short blend between any two
    a = {m: nid() for m in MODES}
    s = {m: nid() for m in MODES}
    w(f'<StateMachine name="Reading" id="{sm}">', 2)
    layer = nid()
    w(f'<StateMachineLayer name="Mode" id="{layer}">', 3)
    w('<AnyState x="200" y="-120"/>', 4); w('<ExitState x="400" y="-120"/>', 4)
    w("<EntryState>", 4); w(f'<StateTransition stateToId="{s["read"]}"/>', 5); w("</EntryState>", 4)
    for si, m in enumerate(MODES):
        w(f'<AnimationState x="{160 + 200 * si}" animationId="{a[m]}" id="{s[m]}">', 4)
        for ti, t in enumerate(MODES):
            if t == m:
                continue
            w(f'<StateTransition stateToId="{s[t]}" duration="{260 if t == "done" else 200}">{cond_mode(ti)}</StateTransition>', 5)
        w("</AnimationState>", 4)
    w("</StateMachineLayer>", 3); w("</StateMachine>", 2)

    L = "linear"
    DEF = dict(scan_o=0, scan_y=-22, turn_x=0, turn_r=0, turn_o=0, top_y=0, check=0, pulse_o=0, pulse_s=1, g_o=1)
    def body(**kw):
        v = {**DEF, **kw}
        def frames(key):
            x = v[key]
            return x if isinstance(x, list) else [(0, x, L)]
        return (keyed(ids["scan"], {"opacity": frames("scan_o"), "y": frames("scan_y")})
                + keyed(ids["turn"], {"x": frames("turn_x"), "rotation": frames("turn_r"), "opacity": frames("turn_o")})
                + keyed(ids["top"], {"y": frames("top_y")})
                + f'<KeyedObject objectId="{ids["check_trim"]}"><KeyedProperty property="end">' + "".join(f'<KeyFrameDouble value="{val}" interpolationType="{it}"' + (f' frame="{fr}"' if fr else "") + "/>" for fr, val, it in frames("check")) + "</KeyedProperty></KeyedObject>"
                + keyed(ids["pulse"], {"opacity": frames("pulse_o"), "scaleX": frames("pulse_s"), "scaleY": frames("pulse_s")})
                + keyed(ids["g"], {"opacity": frames("g_o")}))
    def anim(m, name, dur, loop, **kw):
        w(f'<LinearAnimation {loop}duration="{dur}" name="{name}" id="{a[m]}">{body(**kw)}</LinearAnimation>', 2)
    # reading in the browser: a line sweeps down the paper
    anim("read", "Reading", 96, 'loopValue="loop" ', scan_o=1, scan_y=[(0, -22, L), (96, 22, L)])
    # uploading: the paper bobs, as if lifted
    anim("upload", "Uploading", 54, 'loopValue="pingPong" ', top_y=[(0, 0, "cubic"), (54, -5, "cubic")])
    # indexing, or reading page pictures: the line sweeps and a page is set aside to the left each sweep
    anim("index", "Indexing", 84, 'loopValue="loop" ', scan_o=1, scan_y=[(0, -22, L), (84, 22, L)],
         turn_x=[(0, 0, L), (84, -26, "cubic")], turn_r=[(0, 0, L), (84, -0.42, "cubic")], turn_o=[(0, 0.95, L), (60, 0.6, L), (84, 0, L)])
    # done: the check is drawn, and the ring answers once
    anim("done", "Done", 44, "", check=[(0, 0, L), (8, 0, L), (30, 1, "cubic")], pulse_o=[(0, 0.85, L), (44, 0, "cubic")], pulse_s=[(0, 1, L), (44, 1.2, "cubic")], g_o=[(0, 1, L), (10, 0.35, "cubic")])
    # paused: everything is held and dimmed
    anim("paused", "Paused", 1, "", g_o=0.5)
    w("</Artboard>", 1)
    return ids

w('<Rive version="1" kind="fragment">')
build()
w(f'<DataConverterInterpolator interpolationType="linear" duration="0.45" name="Ease the ring" id="{CONV}"/>', 1)
w(f'<ViewModel defaultInstanceId="{INST}" name="Reading" id="{VM}">', 1)
for k in ("mode", "progress"):
    w(f'<ViewModelPropertyNumber name="{k}" id="{P[k]}"/>', 2)
for k in ("line", "accent", "accentSoft"):
    w(f'<ViewModelPropertyColor name="{k}" id="{P[k]}"/>', 2)
w(f'<ViewModelInstance exports="true" name="Default" id="{INST}">', 2)
for k in ("mode", "progress"):
    w(f'<ViewModelInstanceNumber propertyValue="0" viewModelPropertyId="{P[k]}"/>', 3)
for k in ("line", "accent", "accentSoft"):
    w(f'<ViewModelInstanceColor propertyValue="{COL[k]}" viewModelPropertyId="{P[k]}"/>', 3)
w("</ViewModelInstance>", 2)
w("</ViewModel>", 1)
w("</Rive>")
print("\n".join(out))
