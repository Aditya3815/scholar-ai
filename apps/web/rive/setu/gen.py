#!/usr/bin/env python3
"""Generates scene.rml for the "Setu" (bridge) piece: one artboard per number of themes (2..6).

Host contract (the view model `Setu`, one instance shared by every artboard):
  p1..p6   number  state of theme k:  0 waiting, 1 searching, 2 reading, 3 answered, 4 gap
  cross    boolean the question crosses the bridge (the host sets it when the scan ended with no gap)
  line, accent, accentSoft, warn, ink   colour: the page's own theme tokens, set by the host

Usage: python gen.py [--bg RRGGBB] > scene.rml      (--bg paints a background, for screenshots only; the shipped file has none)
"""
import math, sys

BG = None
if "--bg" in sys.argv:
    BG = sys.argv[sys.argv.index("--bg") + 1].upper()

W, H = 640, 118
DECK_X0, DECK_X1 = 70, 570       # where the planks start and end
BASE_Y, RISE = 84, 20           # the deck's height at the piers, and how much the arch lifts the middle
GAP, PLANK_H = 9, 15
MAX_N = 6
STATES = ["wait", "search", "read", "done", "gap"]   # value k = index in this list

# colours, light theme (tokens.css): the host overwrites them
DEFAULT = {"line": "FFCFC9BB", "accent": "FF3548C8", "accentSoft": "FFE8EBFA", "warn": "FF8F5200", "ink": "FF16181D"}

_n = [0]
def nid():
    _n[0] += 1
    return f"0:{_n[0]}"

out = []
def w(line="", ind=0):
    out.append("    " * ind + line)

VM_ID = nid()
VM_INST = nid()
PROP = {}
for k in range(1, MAX_N + 1):
    PROP[f"p{k}"] = nid()
PROP["cross"] = nid()
for c in DEFAULT:
    PROP[c] = nid()

def bind_color(name):
    return f'<DataBindContext sourcePathIds="{VM_ID}-{PROP[name]}" propertyKey="37"/>'

def arch(t):
    return BASE_Y - RISE * math.sin(math.pi * t)

def solid(name, hex_, ind):
    w(f'<SolidColor colorValue="{DEFAULT[name]}" name="{hex_}">', ind)
    w(bind_color(name), ind + 1)
    w("</SolidColor>", ind)

def artboard(n):
    ab, sm, style = nid(), nid(), nid()
    w(f'<Artboard defaultStateMachineId="{sm}" styleId="{style}" viewModelId="{VM_ID}" viewModelInstanceId="{VM_INST}" x="0" y="{(n - 2) * 220}" width="{W}" height="{H}" name="Setu{n}" id="{ab}">', 1)
    w(f'<LayoutComponentStyle name="Artboard Style" id="{style}"/>', 2)
    if BG:
        w(f'<Fill name="Background"><SolidColor colorValue="FF{BG}" name="Bg"/></Fill>', 2)

    span = DECK_X1 - DECK_X0
    pw = (span - (n - 1) * GAP) / n

    # --- the traveller (top of the draw order) and the ring that answers it on the far pier
    trav = nid(); ring = nid()
    w(f'<Shape x="{DECK_X0 - 30}" y="{BASE_Y - 24}" name="Question" id="{trav}">', 2)
    w('<Ellipse originX="0.5" originY="0.5" width="12" height="12" name="Path"/>', 3)
    w("<Fill name=\"Fill\">", 3); solid("accent", "Accent", 4); w("</Fill>", 3)
    w("</Shape>", 2)
    w(f'<Shape x="{DECK_X1 + 30}" y="{BASE_Y - 24}" opacity="0" name="Arrived" id="{ring}">', 2)
    w('<Ellipse originX="0.5" originY="0.5" width="22" height="22" name="Path"/>', 3)
    w('<Stroke thickness="2" name="Stroke">', 3); solid("accent", "Accent", 4); w("</Stroke>", 3)
    w("</Shape>", 2)

    # --- the planks
    planks = []   # per plank: ids needed by the animations
    for i in range(n):
        t = (i + 0.5) / n
        cx = DECK_X0 + (i + 0.5) * pw + i * GAP
        cy = arch(t)
        slope = -RISE * math.pi / span * math.cos(math.pi * t)
        rot = math.atan(slope)
        node, a_done, a_busy, a_gap, a_slot = nid(), nid(), nid(), nid(), nid()
        w(f'<Node x="{cx:.2f}" y="{cy:.2f}" rotation="{rot:.4f}" name="Theme {i + 1}" id="{node}">', 2)
        # first declared paints on top: answered, then busy, then gap, then the empty slot
        w(f'<Shape opacity="0" name="Answered" id="{a_done}">', 3)
        w(f'<Rectangle originX="0.5" originY="0.5" width="{pw:.2f}" height="{PLANK_H}" cornerRadiusTL="4" name="Path"/>', 4)
        w('<Fill name="Fill">', 4); solid("accent", "Accent", 5); w("</Fill>", 4)
        w("</Shape>", 3)
        w(f'<Shape opacity="0" name="Busy" id="{a_busy}">', 3)
        w(f'<Rectangle originX="0.5" originY="0.5" width="{pw:.2f}" height="{PLANK_H}" cornerRadiusTL="4" name="Path"/>', 4)
        w('<Fill name="Fill">', 4); solid("accentSoft", "Soft", 5); w("</Fill>", 4)
        w('<Stroke thickness="2" name="Stroke">', 4); solid("accent", "Accent", 5); w("</Stroke>", 4)
        w("</Shape>", 3)
        w(f'<Shape opacity="0" name="Gap" id="{a_gap}">', 3)
        w(f'<Rectangle originX="0.5" originY="0.5" width="{pw:.2f}" height="{PLANK_H}" cornerRadiusTL="4" name="Path"/>', 4)
        w('<Stroke thickness="2" name="Stroke">', 4); solid("warn", "Warn", 5)
        w('<DashPath name="Dashes"><Dash length="5" name="On"/><Dash length="4" name="Off"/></DashPath>', 5)
        w("</Stroke>", 4)
        w("</Shape>", 3)
        w(f'<Shape name="Slot" id="{a_slot}">', 3)
        w(f'<Rectangle originX="0.5" originY="0.5" width="{pw:.2f}" height="{PLANK_H}" cornerRadiusTL="4" name="Path"/>', 4)
        w('<Stroke thickness="2" name="Stroke">', 4); solid("line", "Line", 5); w("</Stroke>", 4)
        w("</Shape>", 3)
        w("</Node>", 2)
        planks.append(dict(node=node, y=cy, done=a_done, busy=a_busy, gap=a_gap, slot=a_slot))

    # --- the piers
    for name, x in (("Near pier", DECK_X0 - 30), ("Far pier", DECK_X1 + 30)):
        w(f'<Shape x="{x}" y="{BASE_Y + 8}" name="{name}">', 2)
        w('<Rectangle originX="0.5" originY="0.5" width="16" height="62" cornerRadiusTL="6" name="Path"/>', 3)
        w('<Fill name="Fill">', 3); solid("line", "Line", 4); w("</Fill>", 3)
        w("</Shape>", 2)

    # --- the state machine: one layer for each plank, one for the crossing
    w(f'<StateMachine name="Setu" id="{sm}">', 2)
    anim_xml = []   # animations are written after the machine (the editor opens the first thing declared)
    for i, p in enumerate(planks):
        key = f"p{i + 1}"
        layer = nid()
        w(f'<StateMachineLayer name="Theme {i + 1}" id="{layer}">', 3)
        w("<AnyState x=\"200\" y=\"-120\"/>", 4)
        w("<ExitState x=\"400\" y=\"-120\"/>", 4)
        state_ids = {s: nid() for s in STATES}
        anims = {s: nid() for s in STATES}
        w("<EntryState>", 4); w(f'<StateTransition stateToId="{state_ids["wait"]}"/>', 5); w("</EntryState>", 4)
        for si, s in enumerate(STATES):
            w(f'<AnimationState x="{160 + 200 * si}" y="{60 * (i % 2)}" animationId="{anims[s]}" id="{state_ids[s]}">', 4)
            for ti, t in enumerate(STATES):
                if t == s:
                    continue
                w(f'<StateTransition stateToId="{state_ids[t]}" duration="220">', 5)
                w("<TransitionViewModelCondition opValue=\"equal\">", 6)
                w("<TransitionPropertyViewModelComparator>", 7)
                w("<BindablePropertyNumber>", 8)
                w(f'<DataBindContext sourcePathIds="{VM_ID}-{PROP[key]}" propertyKey="636"/>', 9)
                w("</BindablePropertyNumber>", 8)
                w("</TransitionPropertyViewModelComparator>", 7)
                w(f'<TransitionValueNumberComparator value="{ti}"/>', 7)
                w("</TransitionViewModelCondition>", 6)
                w("</StateTransition>", 5)
            w("</AnimationState>", 4)
        w("</StateMachineLayer>", 3)

        def key_opacity(obj, frames_values):
            s = f'<KeyedObject objectId="{obj}"><KeyedProperty property="opacity">'
            for fr, v, interp in frames_values:
                s += f'<KeyFrameDouble value="{v}" interpolationType="{interp}"' + (f' frame="{fr}"' if fr else "") + "/>"
            return s + "</KeyedProperty></KeyedObject>"

        def key_y(node, y0, frames_values):
            s = f'<KeyedObject objectId="{node}"><KeyedProperty property="y">'
            for fr, dy, interp in frames_values:
                s += f'<KeyFrameDouble value="{y0 + dy:.2f}" interpolationType="{interp}"' + (f' frame="{fr}"' if fr else "") + "/>"
            return s + "</KeyedProperty></KeyedObject>"

        y0 = p["y"]
        slot_on, slot_off = key_opacity(p["slot"], [(0, 1, "linear")]), key_opacity(p["slot"], [(0, 0, "linear")])
        # waiting: all three overlays off (the empty slot is always drawn)
        anim_xml.append(f'<LinearAnimation duration="1" name="T{i + 1} wait" id="{anims["wait"]}">'
                        + key_opacity(p["done"], [(0, 0, "linear")]) + key_opacity(p["busy"], [(0, 0, "linear")]) + key_opacity(p["gap"], [(0, 0, "linear")])
                        + key_y(p["node"], y0, [(0, 0, "linear")]) + slot_on + "</LinearAnimation>")
        # searching: the outline breathes, slowly
        anim_xml.append(f'<LinearAnimation loopValue="pingPong" duration="72" name="T{i + 1} searching" id="{anims["search"]}">'
                        + key_opacity(p["done"], [(0, 0, "linear")]) + key_opacity(p["gap"], [(0, 0, "linear")])
                        + key_opacity(p["busy"], [(0, 0.25, "cubic"), (72, 0.7, "cubic")]) + key_y(p["node"], y0, [(0, 0, "linear")]) + slot_off + "</LinearAnimation>")
        # reading: filled and a little firmer
        anim_xml.append(f'<LinearAnimation loopValue="pingPong" duration="72" name="T{i + 1} reading" id="{anims["read"]}">'
                        + key_opacity(p["done"], [(0, 0, "linear")]) + key_opacity(p["gap"], [(0, 0, "linear")])
                        + key_opacity(p["busy"], [(0, 0.7, "cubic"), (72, 1, "cubic")]) + key_y(p["node"], y0, [(0, 0, "linear")]) + slot_off + "</LinearAnimation>")
        # answered: the plank settles into place (8 px down in 0.4 s) and fills
        anim_xml.append(f'<LinearAnimation duration="30" name="T{i + 1} answered" id="{anims["done"]}">'
                        + key_opacity(p["done"], [(0, 0, "linear"), (14, 1, "cubic")]) + key_opacity(p["busy"], [(0, 0, "linear")]) + key_opacity(p["gap"], [(0, 0, "linear")])
                        + key_y(p["node"], y0, [(0, -8, "linear"), (24, 0, "cubic")]) + slot_off + "</LinearAnimation>")
        # gap: a dashed warm outline fades in, and the plank does not move
        anim_xml.append(f'<LinearAnimation duration="24" name="T{i + 1} gap" id="{anims["gap"]}">'
                        + key_opacity(p["done"], [(0, 0, "linear")]) + key_opacity(p["busy"], [(0, 0, "linear")])
                        + key_opacity(p["gap"], [(0, 0, "linear"), (18, 1, "cubic")]) + key_y(p["node"], y0, [(0, 0, "linear")]) + slot_off + "</LinearAnimation>")

    # the crossing: the question walks the arch to the far pier, and the far pier answers with a ring
    layer = nid(); s_idle, s_cross, s_done = nid(), nid(), nid()
    a_idle, a_cross, a_end = nid(), nid(), nid()
    def cond_cross(val):
        return (f'<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyBoolean>'
                f'<DataBindContext sourcePathIds="{VM_ID}-{PROP["cross"]}" propertyKey="634"/></BindablePropertyBoolean></TransitionPropertyViewModelComparator>'
                f'<TransitionValueBooleanComparator value="{val}"/></TransitionViewModelCondition>')
    w(f'<StateMachineLayer name="Crossing" id="{layer}">', 3)
    w("<AnyState x=\"200\" y=\"-120\"/>", 4); w("<ExitState x=\"400\" y=\"-120\"/>", 4)
    w("<EntryState>", 4); w(f'<StateTransition stateToId="{s_idle}"/>', 5); w("</EntryState>", 4)
    w(f'<AnimationState x="160" animationId="{a_idle}" id="{s_idle}">', 4)
    w(f'<StateTransition stateToId="{s_cross}" duration="120">{cond_cross("true")}</StateTransition>', 5)
    w("</AnimationState>", 4)
    w(f'<AnimationState x="360" animationId="{a_cross}" id="{s_cross}">', 4)
    w(f'<StateTransition stateToId="{s_done}" enableExitTime="true" exitTimeIsPercetange="true" exitTime="100" duration="0"/>', 5)
    w("</AnimationState>", 4)
    w(f'<AnimationState x="560" animationId="{a_end}" id="{s_done}">', 4)
    w(f'<StateTransition stateToId="{s_idle}" duration="200">{cond_cross("false")}</StateTransition>', 5)
    w("</AnimationState>", 4)
    w("</StateMachineLayer>", 3)
    w("</StateMachine>", 2)

    for x in anim_xml:
        w(x, 2)
    # crossing animations: idle = at the near pier; cross = 96 frames along the arch; end = parked at the far pier
    x0, x1 = DECK_X0 - 30, DECK_X1 + 30
    def key_xy(frames, y_off=-24):
        xs = "".join(f'<KeyFrameDouble value="{x:.2f}" interpolationType="linear"' + (f' frame="{f}"' if f else "") + "/>" for f, x, _ in frames)
        ys = "".join(f'<KeyFrameDouble value="{y:.2f}" interpolationType="linear"' + (f' frame="{f}"' if f else "") + "/>" for f, _, y in frames)
        return f'<KeyedObject objectId="{trav}"><KeyedProperty property="x">{xs}</KeyedProperty><KeyedProperty property="y">{ys}</KeyedProperty></KeyedObject>'
    steps = 16
    path = []
    for k in range(steps + 1):
        u = k / steps
        e = u * u * (3 - 2 * u)                       # smoothstep: sets off and arrives gently
        x = x0 + (x1 - x0) * e
        t = min(1, max(0, (x - DECK_X0) / span))
        y = (arch(t) if 0 < t < 1 else BASE_Y) - 20
        path.append((round(96 * u), x, y))
    path[0] = (0, x0, BASE_Y - 20)
    ring_idle = f'<KeyedObject objectId="{ring}"><KeyedProperty property="opacity"><KeyFrameDouble value="0" interpolationType="linear"/></KeyedProperty></KeyedObject>'
    anim = lambda aid, dur, name, body, loop="": f'<LinearAnimation {loop}duration="{dur}" name="{name}" id="{aid}">{body}</LinearAnimation>'
    w(anim(a_idle, 1, "Crossing idle", key_xy([(0, x0, BASE_Y - 20)]) + ring_idle), 2)
    ring_fx = (f'<KeyedObject objectId="{ring}"><KeyedProperty property="opacity"><KeyFrameDouble value="0" interpolationType="linear"/>'
               f'<KeyFrameDouble value="0" interpolationType="linear" frame="90"/><KeyFrameDouble value="0.9" interpolationType="linear" frame="96"/></KeyedProperty>'
               f'<KeyedProperty property="scaleX"><KeyFrameDouble value="0.8" interpolationType="linear"/><KeyFrameDouble value="1" interpolationType="linear" frame="96"/></KeyedProperty>'
               f'<KeyedProperty property="scaleY"><KeyFrameDouble value="0.8" interpolationType="linear"/><KeyFrameDouble value="1" interpolationType="linear" frame="96"/></KeyedProperty></KeyedObject>')
    w(anim(a_cross, 96, "Crossing", key_xy(path) + ring_fx), 2)
    ring_end = (f'<KeyedObject objectId="{ring}"><KeyedProperty property="opacity"><KeyFrameDouble value="0.9" interpolationType="linear"/>'
                f'<KeyFrameDouble value="0" interpolationType="cubic" frame="40"/></KeyedProperty>'
                f'<KeyedProperty property="scaleX"><KeyFrameDouble value="1" interpolationType="linear"/><KeyFrameDouble value="1.9" interpolationType="cubic" frame="40"/></KeyedProperty>'
                f'<KeyedProperty property="scaleY"><KeyFrameDouble value="1" interpolationType="linear"/><KeyFrameDouble value="1.9" interpolationType="cubic" frame="40"/></KeyedProperty></KeyedObject>')
    w(anim(a_end, 40, "Crossing arrived", key_xy([(0, x1, BASE_Y - 20)]) + ring_end), 2)
    w("</Artboard>", 1)

w('<Rive version="1" kind="fragment">')
# the artboards first, so their ids stay low and readable; the view model is a root element after them
for n in range(2, MAX_N + 1):
    artboard(n)
w(f'<ViewModel defaultInstanceId="{VM_INST}" name="Setu" id="{VM_ID}">', 1)
for k in range(1, MAX_N + 1):
    w(f'<ViewModelPropertyNumber name="p{k}" id="{PROP[f"p{k}"]}"/>', 2)
w(f'<ViewModelPropertyBoolean name="cross" id="{PROP["cross"]}"/>', 2)
for c in DEFAULT:
    w(f'<ViewModelPropertyColor name="{c}" id="{PROP[c]}"/>', 2)
w(f'<ViewModelInstance exports="true" name="Default" id="{VM_INST}">', 2)
for k in range(1, MAX_N + 1):
    w(f'<ViewModelInstanceNumber propertyValue="0" viewModelPropertyId="{PROP[f"p{k}"]}"/>', 3)
w(f'<ViewModelInstanceBoolean propertyValue="false" viewModelPropertyId="{PROP["cross"]}"/>', 3)
for c, v in DEFAULT.items():
    w(f'<ViewModelInstanceColor propertyValue="{v}" viewModelPropertyId="{PROP[c]}"/>', 3)
w("</ViewModelInstance>", 2)
w("</ViewModel>", 1)
w("</Rive>")
print("\n".join(out))
