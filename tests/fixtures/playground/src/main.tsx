import { createRoot } from "react-dom/client";
import App from "./App.tsx";

const host = document.getElementById("root");
if (!host) {
  throw new Error("missing #root element");
}
createRoot(host).render(<App />);
