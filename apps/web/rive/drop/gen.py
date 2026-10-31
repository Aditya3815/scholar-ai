#!/usr/bin/env python3
"""Generates scene.rml for the drop zone's picture: a box whose lid opens when a file is carried over it and closes on it when it is dropped. One artboard, 96 x 80.

View model `Drop` (the page's own drag events write it; the file decides nothing):
  over   boolean  a file is being carried over the zone
  drop   boolean  a file was just dropped (the page sets it for about a second)
  off    boolean  the zone is switched off (the page says why in words)
  line, accent, accentSoft  colour  the page's own tokens

Usage: python gen.py [--bg RRGGBB] > scene.rml     (--bg paints a background, for screenshots only; the shipped file has none)
"""
import sys

BG = sys.argv[sys.argv.index("--bg") + 1].upper() if "--bg" in sys.argv else None
W, H = 96, 80
CX, BASE = 48, 68          # the middle of the box, and the line the box stands on
BOX_W, BOX_H = 54, 26
OPEN = -0.62                # how far the lid turns (radians; negative lifts the free edge)

_n = [0]
def nid():
    _n[0] += 1
    return f"0:{_n[0]}"

out = []
def w(s="", i=0):
    out.append("    " * i + s)

VM, INST = nid(), nid()
P = {k: nid() for k in ("over", "drop", "off", "line", "accent", "accentSoft")}
COL = {"line": "FFCFC9BB", "accent": "FF3548C8", "accentSoft": "FFE8EBFA"}

def solid(name, i):
    w(f'<SolidColor colorValue="{COL[name]}" name="{name}">', i)
    w(f'<DataBindContext sourcePathIds="{VM}-{P[name]}" propertyKey="37"/>', i + 1)
    w("</SolidColor>", i)

def cond(*pairs):
    s = ""
    for prop, val in pairs:
        s += (f'<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyBoolean>'
              f'<DataBindContext sourcePathIds="{VM}-{P[prop]}" propertyKey="634"/></BindablePropertyBoolean></TransitionPropertyViewModelComparator>'
              f'<TransitionValueBooleanComparator value="{str(val).lower()}"/></TransitionViewModelCondition>')
    return s

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
    ids = {k: nid() for k in ("g", "hinge", "paper")}
    w(f'<Artboard defaultStateMachineId="{sm}" styleId="{style}" viewModelId="{VM}" viewModelInstanceId="{INST}" x="0" y="0" width="{W}" height="{H}" name="Drop" id="{ab}">', 1)
    w(f'<LayoutComponentStyle name="Artboard Style" id="{style}"/>', 2)
    if BG:
        w(f'<Fill name="Background"><SolidColor colorValue="FF{BG}" name="Bg"/></Fill>', 2)

    w(f'<Node x="{CX}" y="{BASE}" name="Box" id="{ids["g"]}">', 2)
    # the lid, hinged on its left edge (drawn first: on top)
    w(f'<Node x="{-BOX_W / 2}" y="{-BOX_H}" name="Hinge" id="{ids["hinge"]}">', 3)
    w(f'<Shape x="{BOX_W / 2}" y="-1" name="Lid">', 4)
    w(f'<Rectangle originX="0.5" originY="0.5" width="{BOX_W + 4}" height="9" cornerRadiusTL="4" name="Path"/>', 5)
    w('<Fill name="Fill">', 5); solid("accentSoft", 6); w("</Fill>", 5)
    w('<Stroke thickness="2" join="round" name="Stroke">', 5); solid("accent", 6); w("</Stroke>", 5); w("</Shape>", 4)
    w("</Node>", 3)
    # the front of the box
    w(f'<Shape y="{-BOX_H / 2}" name="Front">', 3)
    w(f'<Rectangle originX="0.5" originY="0.5" width="{BOX_W}" height="{BOX_H}" cornerRadiusTL="5" name="Path"/>', 4)
    w('<Fill name="Fill">', 4); solid("accentSoft", 5); w("</Fill>", 4)
    w('<Stroke thickness="2" join="round" name="Stroke">', 4); solid("accent", 5); w("</Stroke>", 4); w("</Shape>", 3)
    # the paper that comes up out of the box (behind the front)
    w(f'<Shape x="0" y="{-BOX_H}" opacity="0" name="Paper" id="{ids["paper"]}">', 3)
    w('<Rectangle originX="0.5" originY="1" width="26" height="32" cornerRadiusTL="4" name="Path"/>', 4)
    w('<Fill name="Fill">', 4); solid("accentSoft", 5); w("</Fill>", 4)
    w('<Stroke thickness="2" name="Stroke">', 4); solid("accent", 5); w("</Stroke>", 4); w("</Shape>", 3)
    # the ground
    w('<Shape y="1.5" name="Ground">', 3)
    w(f'<Rectangle originX="0.5" originY="0.5" width="{BOX_W + 26}" height="3" cornerRadiusTL="1.5" name="Path"/>', 4)
    w('<Fill name="Fill">', 4); solid("line", 5); w("</Fill>", 4); w("</Shape>", 3)
    w("</Node>", 2)

    a = {k: nid() for k in ("idle", "open", "closing", "norm", "dim")}
    s = {k: nid() for k in ("idle", "open", "closing", "norm", "dim")}
    w(f'<StateMachine name="Drop" id="{sm}">', 2)
    # layer 1: the lid and the paper
    l1 = nid()
    w(f'<StateMachineLayer name="Lid" id="{l1}">', 3)
    w('<AnyState x="200" y="-120"/>', 4); w('<ExitState x="400" y="-120"/>', 4)
    w("<EntryState>", 4); w(f'<StateTransition stateToId="{s["idle"]}"/>', 5); w("</EntryState>", 4)
    w(f'<AnimationState x="160" animationId="{a["idle"]}" id="{s["idle"]}">', 4)
    w(f'<StateTransition stateToId="{s["open"]}" duration="260">{cond(("over", True))}</StateTransition>', 5)
    w("</AnimationState>", 4)
    w(f'<AnimationState x="360" animationId="{a["open"]}" id="{s["open"]}">', 4)
    w(f'<StateTransition stateToId="{s["closing"]}" duration="60">{cond(("over", False), ("drop", True))}</StateTransition>', 5)
    w(f'<StateTransition stateToId="{s["idle"]}" duration="260">{cond(("over", False), ("drop", False))}</StateTransition>', 5)
    w("</AnimationState>", 4)
    w(f'<AnimationState x="560" animationId="{a["closing"]}" id="{s["closing"]}">', 4)
    w(f'<StateTransition stateToId="{s["open"]}" duration="120">{cond(("over", True))}</StateTransition>', 5)
    w(f'<StateTransition stateToId="{s["idle"]}" enableExitTime="true" exitTimeIsPercetange="true" exitTime="100" duration="0"/>', 5)
    w("</AnimationState>", 4)
    w("</StateMachineLayer>", 3)
    # layer 2: switched off
    l2 = nid()
    w(f'<StateMachineLayer name="Switched off" id="{l2}">', 3)
    w('<AnyState x="200" y="-120"/>', 4); w('<ExitState x="400" y="-120"/>', 4)
    w("<EntryState>", 4); w(f'<StateTransition stateToId="{s["norm"]}"/>', 5); w("</EntryState>", 4)
    w(f'<AnimationState x="160" animationId="{a["norm"]}" id="{s["norm"]}">', 4)
    w(f'<StateTransition stateToId="{s["dim"]}" duration="200">{cond(("off", True))}</StateTransition>', 5)
    w("</AnimationState>", 4)
    w(f'<AnimationState x="360" animationId="{a["dim"]}" id="{s["dim"]}">', 4)
    w(f'<StateTransition stateToId="{s["norm"]}" duration="200">{cond(("off", False))}</StateTransition>', 5)
    w("</AnimationState>", 4)
    w("</StateMachineLayer>", 3)
    w("</StateMachine>", 2)

    L = "linear"
    def lid(rot, paper_y, paper_o):
        def fr(x): return x if isinstance(x, list) else [(0, x, L)]
        return keyed(ids["hinge"], {"rotation": fr(rot)}) + keyed(ids["paper"], {"y": fr(paper_y), "opacity": fr(paper_o)})
    def anim(k, name, dur, loop, body):
        w(f'<LinearAnimation {loop}duration="{dur}" name="{name}" id="{a[k]}">{body}</LinearAnimation>', 2)
    TOP = -BOX_H            # the top of the box; the paper's foot is below it, behind the front, so it comes up out of the box
    anim("idle", "Closed", 1, "", lid(0, TOP + 26, 0))
    # open: the lid is up and the paper rises and bobs a little, as if waiting for the file
    anim("open", "Open", 60, 'loopValue="pingPong" ', lid(OPEN, [(0, TOP + 5, "cubic"), (60, TOP + 1, "cubic")], 1))
    # closing: the paper goes in, then the lid comes down with a small rebound
    anim("closing", "Closing", 40, "", lid([(0, OPEN, L), (14, OPEN, L), (26, 0.05, "cubic"), (32, 0, "cubic")], [(0, TOP + 3, L), (14, TOP + 26, "cubic")], [(0, 1, L), (12, 1, L), (16, 0, L)]))
    anim("norm", "Switched on", 1, "", keyed(ids["g"], {"opacity": [(0, 1, L)]}))
    anim("dim", "Switched off", 1, "", keyed(ids["g"], {"opacity": [(0, 0.4, L)]}))
    w("</Artboard>", 1)

w('<Rive version="1" kind="fragment">')
build()
w(f'<ViewModel defaultInstanceId="{INST}" name="Drop" id="{VM}">', 1)
for k in ("over", "drop", "off"):
    w(f'<ViewModelPropertyBoolean name="{k}" id="{P[k]}"/>', 2)
for k in ("line", "accent", "accentSoft"):
    w(f'<ViewModelPropertyColor name="{k}" id="{P[k]}"/>', 2)
w(f'<ViewModelInstance exports="true" name="Default" id="{INST}">', 2)
for k in ("over", "drop", "off"):
    w(f'<ViewModelInstanceBoolean propertyValue="false" viewModelPropertyId="{P[k]}"/>', 3)
for k in ("line", "accent", "accentSoft"):
    w(f'<ViewModelInstanceColor propertyValue="{COL[k]}" viewModelPropertyId="{P[k]}"/>', 3)
w("</ViewModelInstance>", 2)
w("</ViewModel>", 1)
w("</Rive>")
print("\n".join(out))
