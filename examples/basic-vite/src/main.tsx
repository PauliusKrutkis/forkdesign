import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="page">
      <section className="hero" data-view="hero">
        <p className="eyebrow">Design Crit example</p>
        <h1>Review your running UI without leaving the browser.</h1>
        <p className="lede">
          Click the Design Crit button, select this headline or card, and leave a
          comment. Markers are written back into this example's TSX source.
        </p>
        <div className="actions">
          <button type="button">Start review</button>
          <a href="https://github.com/PauliusKrutkis/design-crit">View source</a>
        </div>
      </section>

      <section className="card" data-view="metrics">
        <span className="metric">42</span>
        <div>
          <h2>Design notes</h2>
          <p>
            Iteration snapshots and screenshots are local artifacts under
            <code>designs/</code>.
          </p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
