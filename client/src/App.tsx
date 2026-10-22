import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { healthSchema } from '../../shared/health.js';

function ServerStatus() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    void fetch('/health', { signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Server unavailable.');
        healthSchema.parse(await response.json());
        if (!controller.signal.aborted) setStatus('ready');
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('unavailable'); });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="server-status">
      <span role="status" className={`status-label ${status}`}>
        <span aria-hidden="true" className="status-dot" />
        {status === 'ready' ? 'Server ready' : status === 'checking' ? 'Checking server…' : 'Server unavailable'}
      </span>
      {status === 'unavailable' && <button className="text-button" onClick={() => { setStatus('checking'); setAttempt(attempt + 1); }}>Retry</button>}
    </div>
  );
}

function Home() {
  return (
    <>
      <section className="intro">
        <p className="eyebrow">A little strategy. A lot of personality.</p>
        <h1>What will<br />you <span>build?</span></h1>
        <p className="lede">Bid on the things you love. Make your budget count. Put together something only you would create.</p>
        <div className="game-facts"><span>2–5 players</span><span>The host plays too</span><span>Fictional currency</span></div>
      </section>
      <section className="entry-grid" aria-label="Get started">
        <article className="entry-card primary-card">
          <span className="card-number" aria-hidden="true">01 / MAKE IT YOURS</span>
          <h2>Start with an idea</h2>
          <p>A perfect dragon, an extraordinary life, an unforgettable villain. Your theme sets the scene.</p>
          <Link className="button primary" to="/builder">Explore the builder <span aria-hidden="true">↗</span></Link>
          <span className="availability">Builder preview · editing arrives in Milestone 3</span>
        </article>
        <article className="entry-card">
          <span className="card-number" aria-hidden="true">02 / GET TOGETHER</span>
          <h2>Join the table</h2>
          <p>Bring your friends and your best ideas. Each player gets a seat, a budget, and a build of their own.</p>
          <button className="button" disabled aria-describedby="join-availability">Join with a room code</button>
          <span id="join-availability" className="availability">Room creation and joining arrive in Milestone 4</span>
        </article>
      </section>
      <aside className="foundation-note"><span className="note-mark" aria-hidden="true">↳</span><p><strong>The foundation is ready.</strong> This is the first development milestone. Explore the page shells; games and saved designs arrive in later milestones.</p></aside>
    </>
  );
}

function Builder() {
  return (
    <>
      <div className="page-heading"><p className="eyebrow">Your idea, your game</p><h1>The workshop</h1><p className="lede">A place to turn a theme into a table full of possibilities.</p></div>
      <section className="workshop-grid" aria-label="Builder preview">
        <div className="panel empty-panel">
          <span className="empty-icon" aria-hidden="true">＋</span>
          <h2>Room for your next idea</h2>
          <p>The editor arrives in Milestone 3. You’ll be able to add options and images, set a fictional budget, and save drafts to this browser.</p>
          <span className="tag">Page shell · nothing saved yet</span>
        </div>
        <aside className="panel builder-notes">
          <p className="eyebrow">From idea to auction</p>
          <ol className="steps">
            <li><strong>Choose a theme</strong><span>Give the group something to imagine.</span></li>
            <li><strong>Fill it with possibilities</strong><span>Add the options players will bid on.</span></li>
            <li><strong>Bring everyone together</strong><span>Host and play with 1–4 friends.</span></li>
          </ol>
          <p className="small-note">Guest drafts will stay in your browser. Hosting will share a temporary copy of the game content with your room.</p>
        </aside>
      </section>
    </>
  );
}

function RoomShell({ display = false }: { display?: boolean }) {
  const { code } = useParams();
  return (
    <section className="panel route-shell">
      <p className="eyebrow">{display ? 'Shared screen' : 'Around the table'}</p>
      <h1>{display ? 'A view for everyone' : 'Your game room'}</h1>
      <p className="route-code">Requested code: <strong>{code}</strong></p>
      <p className="lede">{display
        ? 'The optional read-only display arrives in Milestone 5. It will use no player seat and have no game controls.'
        : 'Room creation, joining, and live play arrive in Milestone 4. The host will play alongside everyone else, with 2–5 players in total.'}</p>
      <p className="small-note">This is a page shell. No room has been looked up or joined.</p>
      <Link className="button primary" to="/">Back to home</Link>
    </section>
  );
}

function Admin() {
  return (
    <section className="panel route-shell">
      <p className="eyebrow">Template collection</p>
      <h1>A home for great ideas</h1>
      <p className="lede">Administrator sign-in and permanent template management arrive in Milestone 7.</p>
      <p>Administrator access will manage the template collection. Players will be able to create local designs and host without an account.</p>
      <span className="tag">Page shell · sign-in unavailable</span>
      <Link className="button primary" to="/builder">Explore the builder</Link>
    </section>
  );
}

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    const name = pathname === '/' ? 'Make it yours' : pathname.startsWith('/builder') ? 'Workshop' : pathname.startsWith('/admin') ? 'Templates' : pathname.startsWith('/display') ? 'Shared display' : 'Game room';
    document.title = `${name} · Bid & Build`;
  }, [pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Bid & Build home"><img src="/favicon.svg" width="38" height="38" alt="" /><span>Bid <span className="brand-amp">&</span> Build</span></Link>
        <nav aria-label="Main navigation"><NavLink to="/" end>Home</NavLink><NavLink to="/builder">Builder</NavLink><NavLink to="/admin">Admin</NavLink></nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/room/:code" element={<RoomShell />} />
          <Route path="/display/:code" element={<RoomShell display />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<section className="panel route-shell"><h1>Page not found</h1><Link className="button primary" to="/">Back to home</Link></section>} />
        </Routes>
      </main>
      <footer className="site-footer"><span>Made for a good time together.</span><ServerStatus /></footer>
    </div>
  );
}
