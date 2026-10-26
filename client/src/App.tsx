import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { checkServer, useServerReady } from './serverConnection.js';
import { AppInstallation } from './pwa.js';
import { AppearanceButton } from './appearance/Appearance.js';

const Builder = lazy(() => import('./builder/Builder.js'));
const Room = lazy(() => import('./rooms/Room.js'));
const Display = lazy(() => import('./rooms/Display.js'));
const Admin = lazy(() => import('./admin/Admin.js'));
const Catalogue = lazy(() => import('./admin/Catalogue.js'));

function ServerStatus() {
  const ready = useServerReady();
  return <div className="server-status"><span role="status" className={`status-label ${ready ? 'ready' : 'unavailable'}`}><span aria-hidden="true" className="status-dot" />{ready ? 'Server ready' : 'Connecting to the server. Server actions are disabled.'}</span>{!ready && <button className="text-button" onClick={() => void checkServer()}>Retry connection</button>}</div>;
}

function Home() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
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
          <Link className="text-button" to="/templates">Browse ready-made templates</Link>
          <span className="availability">Local drafts · image uploads · portable JSON</span>
        </article>
        <article className="entry-card">
          <span className="card-number" aria-hidden="true">02 / GET TOGETHER</span>
          <h2>Join the table</h2>
          <p>Bring your friends and your best ideas. Each player gets a seat, a budget, and a build of their own.</p>
          <form className="join-code-form" onSubmit={(event) => { event.preventDefault(); navigate(`/room/${code.trim().toUpperCase()}`); }}><label htmlFor="join-code">Room code</label><input id="join-code" value={code} maxLength={8} autoCapitalize="characters" autoComplete="off" onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="8-character code" required pattern="[A-HJ-NP-Z2-9]{8}" /><button className="button primary" disabled={!/^[A-HJ-NP-Z2-9]{8}$/.test(code)}>Join with a room code</button></form>
          <span className="availability">Your host’s invite link works too.</span>
        </article>
      </section>
      <aside className="foundation-note"><span className="note-mark" aria-hidden="true">↳</span><p><strong>Make it, then play it.</strong> Save designs in your browser or host a temporary game for friends. Each player bids with the same starting budget.</p></aside>
    </>
  );
}

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    const name = pathname === '/' ? 'Make it yours' : pathname.startsWith('/builder') ? 'Workshop' : pathname.startsWith('/admin') || pathname.startsWith('/templates') ? 'Templates' : pathname.startsWith('/display') ? 'Shared display' : 'Game room';
    document.title = `${name} · Bid & Build`;
  }, [pathname]);
  if (/^\/(room|display)\//.test(pathname)) return <main id="main" className="game-route"><Suspense fallback={<p role="status">Opening game…</p>}><Routes><Route path="/room/:code" element={<Room />} /><Route path="/display/:code" element={<Display />} /></Routes></Suspense></main>;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Bid & Build home"><img src="/favicon.svg" width="38" height="38" alt="" /><span>Bid <span className="brand-amp">&</span> Build</span></Link>
        <nav aria-label="Main navigation"><NavLink to="/" end>Home</NavLink><NavLink to="/builder">Builder</NavLink><NavLink to="/templates">Templates</NavLink><NavLink to="/admin">Admin</NavLink></nav><AppearanceButton className="game-button appearance-launch" />
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/builder" element={<Suspense fallback={<p role="status">Opening the workshop…</p>}><Builder /></Suspense>} />
          <Route path="/room/:code" element={<Suspense fallback={<p role="status">Opening room…</p>}><Room /></Suspense>} />
          <Route path="/admin" element={<Suspense fallback={<p role="status">Opening admin...</p>}><Admin /></Suspense>} />
          <Route path="/templates" element={<Suspense fallback={<p role="status">Opening catalogue...</p>}><Catalogue /></Suspense>} />
          <Route path="*" element={<section className="panel route-shell"><h1>Page not found</h1><Link className="button primary" to="/">Back to home</Link></section>} />
        </Routes>
      </main>
      <AppInstallation /><footer className="site-footer"><span>Made for a good time together.</span><ServerStatus /></footer>
    </div>
  );
}
