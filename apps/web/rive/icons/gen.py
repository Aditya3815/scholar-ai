#!/usr/bin/env python3
"""Three small icons as one Rive file, to test hover, press and toggle driven by the page (the DOM button owns focus, keyboard and the label).

View model `Icon` (shared): hover, down, on  (booleans, set by the page from the button's own events)   ink, accent  (colours, the page's tokens)
Artboards: Bookmark (save a paper), CopyCheck (copy a reference), Bell (notify me).  48 x 48 each.
"""
import sys

BG = sys.argv[sys.argv.index("--bg") + 1].upper() if "--bg" in sys.argv else None
_n = [0]
def nid():
    _n[0] += 1
    return f"0:{_n[0]}"

out = []
def w(s="", i=0):
    out.append("    " * i + s)

VM, INST = nid(), nid()
P = {k: nid() for k in ("hover", "down", "on", "ink", "accent")}
COL = {"ink": "FF565A63", "accent": "FF3548C8"}

def solid(name, i):
    w(f'<SolidColor colorValue="{COL[name]}" name="{name}">', i)
    w(f'<DataBindContext sourcePathIds="{VM}-{P[name]}" propertyKey="37"/>', i + 1)
    w("</SolidColor>", i)

def cond(prop, val):
    return (f'<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyBoolean>'
            f'<DataBindContext sourcePathIds="{VM}-{P[prop]}" propertyKey="634"/></BindablePropertyBoolean></TransitionPropertyViewModelComparator>'
            f'<TransitionValueBooleanComparator value="{str(val).lower()}"/></TransitionViewModelCondition>')

STATES = ["rest", "hover", "down", "on"]
# who goes where, in this order (the first that passes wins): on beats down beats hover
ROUTES = {
    "rest":  [("on", [("on", True)]), ("down", [("down", True)]), ("hover", [("hover", True)])],
    "hover": [("on", [("on", True)]), ("down", [("down", True)]), ("rest", [("hover", False)])],
    "down":  [("on", [("on", True)]), ("hover", [("down", False), ("hover", True)]), ("rest", [("down", False), ("hover", False)])],
    "on":    [("hover", [("on", False), ("hover", True)]), ("rest", [("on", False), ("hover", False)])],
}
DUR = {"rest": 160, "hover": 140, "down": 70, "on": 120}   # blend time into each state, ms

def kf(frames, prop):
    s = f'<KeyedProperty property="{prop}">'
    for fr, v, interp in frames:
        s += f'<KeyFrameDouble value="{v}" interpolationType="{interp}"' + (f' frame="{fr}"' if fr else "") + "/>"
    return s + "</KeyedProperty>"

def keyed(obj, props):
    return f'<KeyedObject objectId="{obj}">' + "".join(kf(f, p) for p, f in props.items()) + "</KeyedObject>"

def machine(sm, anims, ind=2):
    """anims: {state: animation id}"""
    w(f'<StateMachine name="Icon" id="{sm}">', ind)
    layer = nid()
    w(f'<StateMachineLayer name="Face" id="{layer}">', ind + 1)
    w('<AnyState x="200" y="-120"/>', ind + 2); w('<ExitState x="400" y="-120"/>', ind + 2)
    ids = {s: nid() for s in STATES}
    w("<EntryState>", ind + 2); w(f'<StateTransition stateToId="{ids["rest"]}"/>', ind + 3); w("</EntryState>", ind + 2)
    for si, s in enumerate(STATES):
        w(f'<AnimationState x="{160 + 200 * si}" animationId="{anims[s]}" id="{ids[s]}">', ind + 2)
        for target, conds in ROUTES[s]:
            w(f'<StateTransition stateToId="{ids[target]}" duration="{DUR[target]}">', ind + 3)
            for p, v in conds:
                w(cond(p, v), ind + 4)
            w("</StateTransition>", ind + 3)
        w("</AnimationState>", ind + 2)
    w("</StateMachineLayer>", ind + 1)
    w("</StateMachine>", ind)

def artboard(name, y, build):
    ab, sm, style = nid(), nid(), nid()
    w(f'<Artboard defaultStateMachineId="{sm}" styleId="{style}" viewModelId="{VM}" viewModelInstanceId="{INST}" x="0" y="{y}" width="48" height="48" name="{name}" id="{ab}">', 1)
    w(f'<LayoutComponentStyle name="Artboard Style" id="{style}"/>', 2)
    if BG:
        w(f'<Fill name="Background"><SolidColor colorValue="FF{BG}" name="Bg"/></Fill>', 2)
    build(sm)
    w("</Artboard>", 1)

def anim(aid, name, dur, body, loop=""):
    w(f'<LinearAnimation {loop}duration="{dur}" name="{name}" id="{aid}">{body}</LinearAnimation>', 2)

# ---------------------------------------------------------------- bookmark: lifts on hover, shrinks on press, fills with a ring when saved
def bookmark(sm):
    g, fill, edge, ring = nid(), nid(), nid(), nid()
    pts = [(-10, -16), (10, -16), (10, 15), (0, 7), (-10, 15)]
    def path(i):
        w('<PointsPath isClosed="true" name="Path">', i)
        for x, y in pts:
            w(f'<StraightVertex x="{x}" y="{y}" radius="3"/>', i + 1)
        w("</PointsPath>", i)
    w(f'<Node x="24" y="24" name="Bookmark" id="{g}">', 2)
    w(f'<Shape opacity="0" name="Ring" id="{ring}">', 3)
    w('<Ellipse width="30" height="30" originX="0.5" originY="0.5" name="Path"/>', 4)
    w('<Stroke thickness="2" name="Stroke">', 4); solid("accent", 5); w("</Stroke>", 4); w("</Shape>", 3)
    w(f'<Shape opacity="0" name="Saved" id="{fill}">', 3); path(4)
    w('<Fill name="Fill">', 4); solid("accent", 5); w("</Fill>", 4); w("</Shape>", 3)
    w(f'<Shape opacity="0" name="Edge" id="{edge}">', 3); path(4)
    w('<Stroke thickness="2" join="round" name="Stroke">', 4); solid("accent", 5); w("</Stroke>", 4); w("</Shape>", 3)
    w('<Shape name="Outline">', 3); path(4)
    w('<Stroke thickness="2" join="round" name="Stroke">', 4); solid("ink", 5); w("</Stroke>", 4); w("</Shape>", 3)
    w("</Node>", 2)
    a = {s: nid() for s in STATES}
    machine(sm, a)
    L = "linear"
    def body(y, sc, edge_o, fill_o, ring_o=0, extra=""):
        return (keyed(g, {"y": [(0, 24 + y, L)], "scaleX": [(0, sc, L)], "scaleY": [(0, sc, L)]}) + keyed(edge, {"opacity": [(0, edge_o, L)]})
                + keyed(fill, {"opacity": [(0, fill_o, L)]}) + keyed(ring, {"opacity": [(0, ring_o, L)]}) + extra)
    anim(a["rest"], "rest", 1, body(0, 1, 0, 0))
    anim(a["hover"], "hover", 1, body(-2, 1, 1, 0))
    anim(a["down"], "down", 1, body(0, 0.88, 1, 0))
    pop = (keyed(g, {"y": [(0, 24, L)], "scaleX": [(0, 1, L), (7, 1.18, "cubic"), (18, 1, "cubic")], "scaleY": [(0, 1, L), (7, 1.18, "cubic"), (18, 1, "cubic")]})
           + keyed(edge, {"opacity": [(0, 1, L)]}) + keyed(fill, {"opacity": [(0, 0, L), (9, 1, "cubic")]})
           + keyed(ring, {"opacity": [(0, 0.85, L), (30, 0, "cubic")], "scaleX": [(0, 0.6, L), (30, 1.5, "cubic")], "scaleY": [(0, 0.6, L), (30, 1.5, "cubic")]}))
    anim(a["on"], "saved", 30, pop)

# ---------------------------------------------------------------- copy: two sheets that part on hover, and a check that is drawn when copied
def copycheck(sm):
    back, front, chk, trim = nid(), nid(), nid(), nid()
    w(f'<Shape x="22" y="22" name="Back sheet" id="{back}">', 2)
    w('<Rectangle width="20" height="22" originX="0.5" originY="0.5" cornerRadiusTL="4" name="Path"/>', 3)
    w('<Stroke thickness="2" name="Stroke">', 3); solid("ink", 4); w("</Stroke>", 3); w("</Shape>", 2)
    w(f'<Shape x="27" y="27" name="Front sheet" id="{front}">', 2)
    w('<Rectangle width="20" height="22" originX="0.5" originY="0.5" cornerRadiusTL="4" name="Path"/>', 3)
    w('<Stroke thickness="2" name="Stroke">', 3); solid("ink", 4); w("</Stroke>", 3); w("</Shape>", 2)
    trim_obj = nid()   # the TrimPath's own id, for the keyframes
    w(f'<GroupEffect name="Draw" id="{trim}"><TrimPath start="0" end="0" name="Trim" id="{trim_obj}"/></GroupEffect>', 2)
    w(f'<Shape x="24" y="25" name="Check" id="{chk}">', 2)
    w('<PointsPath name="Path">', 3)
    for x, y in ((-10, 0), (-3, 7), (10, -8)):
        w(f'<StraightVertex x="{x}" y="{y}"/>', 4)
    w("</PointsPath>", 3)
    w('<Stroke thickness="3" cap="round" join="round" name="Stroke">', 3); solid("accent", 4)
    w(f'<TargetEffect targetId="{trim}" name="Use Draw"/>', 4); w("</Stroke>", 3); w("</Shape>", 2)
    a = {s: nid() for s in STATES}
    machine(sm, a)
    L = "linear"
    def body(bx, fx, sheets_o, draw):
        return (keyed(back, {"x": [(0, 22 + bx, L)], "y": [(0, 22 + bx, L)], "opacity": [(0, sheets_o, L)]})
                + keyed(front, {"x": [(0, 27 + fx, L)], "y": [(0, 27 + fx, L)], "opacity": [(0, sheets_o, L)]})
                + f'<KeyedObject objectId="{trim_obj}"><KeyedProperty property="end"><KeyFrameDouble value="{draw}" interpolationType="linear"/></KeyedProperty></KeyedObject>')
    anim(a["rest"], "rest", 1, body(0, 0, 1, 0))
    anim(a["hover"], "hover", 1, body(-2, 2, 1, 0))
    anim(a["down"], "down", 1, body(0, 0, 1, 0))
    done = (keyed(back, {"x": [(0, 22, L)], "y": [(0, 22, L)], "opacity": [(0, 1, L), (8, 0, "cubic")]})
            + keyed(front, {"x": [(0, 27, L)], "y": [(0, 27, L)], "opacity": [(0, 1, L), (8, 0, "cubic")]})
            + f'<KeyedObject objectId="{trim_obj}"><KeyedProperty property="end"><KeyFrameDouble value="0" interpolationType="linear"/><KeyFrameDouble value="1" interpolationType="cubic" frame="22"/></KeyedProperty></KeyedObject>')
    anim(a["on"], "copied", 24, done)

# ---------------------------------------------------------------- bell: rings once on hover (a damped swing), fills when it is on
def bell(sm):
    pivot, body_f, body_o, clap = nid(), nid(), nid(), nid()
    verts = [("S", -13, 11), ("S", -9, -2), ("C", 0, -12), ("S", 9, -2), ("S", 13, 11)]
    def path(i):
        w('<PointsPath isClosed="true" name="Path">', i)
        for k, x, y in verts:
            if k == "S":
                w(f'<StraightVertex x="{x}" y="{y}" radius="3"/>', i + 1)
            else:
                w(f'<CubicMirroredVertex x="{x}" y="{y}" rotation="0" distance="9"/>', i + 1)
        w("</PointsPath>", i)
    w(f'<Node x="24" y="10" name="Pivot" id="{pivot}">', 2)
    w(f'<Shape y="14" opacity="0" name="Filled" id="{body_f}">', 3); path(4)
    w('<Fill name="Fill">', 4); solid("accent", 5); w("</Fill>", 4); w("</Shape>", 3)
    w(f'<Shape y="14" name="Bell" id="{body_o}">', 3); path(4)
    w('<Stroke thickness="2" join="round" name="Stroke">', 4); solid("ink", 5); w("</Stroke>", 4); w("</Shape>", 3)
    w(f'<Shape y="29" name="Clapper" id="{clap}">', 3)
    w('<Ellipse width="6" height="6" originX="0.5" originY="0.5" name="Path"/>', 4)
    w('<Fill name="Fill">', 4); solid("ink", 5); w("</Fill>", 4); w("</Shape>", 3)
    w("</Node>", 2)
    a = {s: nid() for s in STATES}
    machine(sm, a)
    L = "linear"
    def body(rot, fill_o):
        return keyed(pivot, {"rotation": [(0, rot, L)]}) + keyed(body_f, {"opacity": [(0, fill_o, L)]})
    anim(a["rest"], "rest", 1, body(0, 0))
    swing = [(0, 0, L), (6, -0.42, "cubic"), (14, 0.34, "cubic"), (22, -0.22, "cubic"), (30, 0.12, "cubic"), (38, 0, "cubic")]
    anim(a["hover"], "ring", 38, keyed(pivot, {"rotation": swing}) + keyed(body_f, {"opacity": [(0, 0, L)]}))
    anim(a["down"], "down", 1, body(0, 0))
    anim(a["on"], "on", 38, keyed(pivot, {"rotation": swing}) + keyed(body_f, {"opacity": [(0, 0, L), (10, 1, "cubic")]}))

w('<Rive version="1" kind="fragment">')
artboard("Bookmark", 0, bookmark)
artboard("CopyCheck", 70, copycheck)
artboard("Bell", 140, bell)
w(f'<ViewModel defaultInstanceId="{INST}" name="Icon" id="{VM}">', 1)
for k in ("hover", "down", "on"):
    w(f'<ViewModelPropertyBoolean name="{k}" id="{P[k]}"/>', 2)
for k in ("ink", "accent"):
    w(f'<ViewModelPropertyColor name="{k}" id="{P[k]}"/>', 2)
w(f'<ViewModelInstance exports="true" name="Default" id="{INST}">', 2)
for k in ("hover", "down", "on"):
    w(f'<ViewModelInstanceBoolean propertyValue="false" viewModelPropertyId="{P[k]}"/>', 3)
for k in ("ink", "accent"):
    w(f'<ViewModelInstanceColor propertyValue="{COL[k]}" viewModelPropertyId="{P[k]}"/>', 3)
w("</ViewModelInstance>", 2)
w("</ViewModel>", 1)
w("</Rive>")
print("\n".join(out))
