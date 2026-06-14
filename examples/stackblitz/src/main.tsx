import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="page">
      <section className="hero" data-view="hero">
        <p className="eyebrow">ForkDesign playground</p>
        <h1>Review your running UI without leaving the browser.</h1>
        <p className="lede">
          Click the ForkDesign pill (bottom-right), select this headline or the
          card, and leave a comment. The marker is written back into this
          sandbox's TSX source — open <code>src/main.tsx</code> to see the diff.
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
            Agent iteration needs a local agent and is not available in this
            sandbox — commenting works fully. Run it locally for variants.
          </p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
