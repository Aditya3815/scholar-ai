import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, m } from "motion/react";
import { useState, type ReactNode } from "react";
import { spring } from "../lib/motion";

/**
 * Radix Popover (focus trap, Esc, aria) + Motion entrance/exit. Content ek hi jagah animate hota hai,
 * isliye CiteMenu aur ReadingControls dono isse use karte hain.
 */
export function Pop({
  trigger,
  children,
  align = "start",
  label,
}: {
  trigger: (open: boolean) => ReactNode;
  /** Plain content, or a function that receives `close` (for menu items that should dismiss the popover). */
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end" | "center";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger(open)}</Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content asChild forceMount sideOffset={8} align={align} collisionPadding={12} aria-label={label}>
              <m.div
                className="pop"
                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12 } }}
                transition={spring}
              >
                {typeof children === "function" ? children(() => setOpen(false)) : children}
              </m.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
