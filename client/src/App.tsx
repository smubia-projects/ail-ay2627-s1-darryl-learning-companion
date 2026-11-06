import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { CircleUserRound, RotateCcw } from 'lucide-react';
import { FoundationView } from '@/views/FoundationView';
import { OnboardingView } from '@/views/OnboardingView';
import { CatalogueView, HomeView } from '@/views/HomeView';
import { useSession } from '@/auth/session-context';
import { BackgroundAsciiWake } from '@/components/ui/background-ascii-wake';
import { ButtonUiLink } from '@/components/ui/button-ui';
import { LessonView } from '@/views/LessonView';
import { QuizView } from '@/views/QuizView';
import { RateLimitGate } from '@/components/RateLimitGate';

function AccountActions({ displayName }: { displayName: string }) {
  const { startOver } = useSession();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  async function restart() {
    if (!window.confirm('Start over as a new learner? Your progress in this browser will be cleared.')) return;
    setPending(true);
    try { await startOver(); navigate('/onboarding', { replace: true }); }
    finally { setPending(false); }
  }
  return <div className="account-actions">
    <span className="profile-badge"><CircleUserRound size={19} /><span className="profile-name" title={displayName}>{displayName}</span></span>
    <button type="button" className="sign-out-button" disabled={pending} onClick={() => { void restart(); }}><RotateCcw size={16} /> {pending ? 'Starting over…' : 'Start over'}</button>
  </div>;
}

export function App() {
  const { session, profile, status } = useSession();
  const location = useLocation();
  const landing = location.pathname === '/';
  const inProduct = Boolean(session && profile?.onboardingComplete && location.pathname !== '/');
  const unavailable = <p role="alert">Could not start your learning session. Please reload the page to try again.</p>;
  const gated = (view: React.ReactNode) => status === 'loading' ? <p role="status">Loading…</p> : status === 'unavailable' || !session || !profile ? unavailable : !profile.onboardingComplete ? <Navigate to="/onboarding" replace /> : view;
  return <>
    {!landing && <BackgroundAsciiWake reducedMotion={profile?.reducedMotion ?? false} />}
    <a className="skip-link" href="#main-content">Skip to content</a>
    {!landing && <header className="app-header">
      <nav className="header-inner" aria-label="Main navigation">
        <Link className="brand" to={inProduct ? '/home' : '/'}><img className="brand-mark" src="/logo.svg" alt="" /> LearningCompanion</Link>
        {inProduct && <div className="main-links"><NavLink to="/home">Home</NavLink><NavLink to="/learn">Learn</NavLink></div>}
        {session && profile && <AccountActions displayName={session.displayName} />}
      </nav>
    </header>}
    <main id="main-content" className={`app-main${landing ? ' landing-main' : ''}`} tabIndex={-1} data-reduced-motion={profile?.reducedMotion || undefined}>
      <Routes>
        <Route path="/" element={<FoundationView />} />
        <Route path="/onboarding" element={status === 'loading' ? <p role="status">Loading…</p> : session && profile ? <OnboardingView /> : unavailable} />
        <Route path="/home" element={gated(<HomeView />)} />
        <Route path="/learn" element={gated(<CatalogueView />)} />
        <Route path="/learn/:sessionId" element={gated(<LessonView />)} />
        <Route path="/learn/:sessionId/quiz" element={gated(<QuizView />)} />
        <Route path="/map" element={<Navigate to="/learn" replace />} />
        <Route path="*" element={<>
          <h1 className="mb-3 text-3xl font-semibold">Page not found</h1>
          <p className="mb-5 text-muted-foreground">This page is not available.</p>
          <ButtonUiLink to="/">Back to LearningCompanion</ButtonUiLink>
        </>} />
      </Routes>
    </main>
    <RateLimitGate />
  </>;
}
