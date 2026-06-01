import { useEffect, useState } from "react";
import { readViewport } from "../lib/bubble-formatters.ts";

export function useViewport(): { width: number; height: number } {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize);
    };
  }, []);

  return viewport;
}
