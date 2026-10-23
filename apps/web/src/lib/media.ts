import { useSyncExternalStore } from "react";

/** A CSS media query as a React value ("(max-width: 900px)"). False on the server and where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== "function") return () => {};
      const mq = matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
    () => false,
  );
}
