import { useEffect } from "react";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";

/** Re-run `reload` after each Vite HMR update in dev. No-op in production. */
export function useViteHmrReload(reload: () => void | Promise<void>): void {
  useEffect(() => {
    if (!import.meta.hot) {
      return;
    }
    const handler = () => {
      Promise.resolve(reload()).catch(ignorePromiseRejection);
    };
    import.meta.hot.on("vite:afterUpdate", handler);
    return () => {
      import.meta.hot?.off("vite:afterUpdate", handler);
    };
  }, [reload]);
}
