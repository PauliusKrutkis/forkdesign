import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="page">
      <section className="hero" data-view="hero">
        <p className="eyebrow">ForkDesign starter</p>
        <h1>Review your running UI without leaving the browser.</h1>
        <p className="lede">
          Click the ForkDesign pill (bottom-right), select this headline or the
          card, and leave a comment. The marker is written back into your TSX
          source — open <code>src/main.tsx</code> to see the diff.
        </p>
        <div className="actions">
          <button type="button">Start review</button>
          <a href="https://github.com/PauliusKrutkis/forkdesign">View source</a>
        </div>
      </section>

      <section className="card" data-view="metrics">
        <span className="metric">42</span>
        <div>
          <h2>Design notes</h2>
          <p>
            Configure a local agent (Cursor or Claude, your keys) and switch to
            Agent mode to generate source-backed variants, then keep the one you
            like — every change lands as a <code>git diff</code>.
          </p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
