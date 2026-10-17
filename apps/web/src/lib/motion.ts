/** Shared motion tokens: ek jagah se springs/durations, taaki poora app ek hi "feel" mein rahe. */
export const spring = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 } as const;
export const springSoft = { type: "spring", stiffness: 240, damping: 28, mass: 0.9 } as const;
export const springPop = { type: "spring", stiffness: 520, damping: 16, mass: 0.6 } as const;
export const easeOut = [0.22, 1, 0.36, 1] as const;

/** Stagger delay: pehle kuch items hi stagger hote hain, lambi list mein delay cap hota hai. */
export const stagger = (i: number, step = 0.045, max = 8) => Math.min(i, max) * step;
