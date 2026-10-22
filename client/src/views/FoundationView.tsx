import { Link, useNavigate } from 'react-router';
import { ArrowRight, BookOpen, CircleCheck, Compass } from 'lucide-react';
import { ButtonUi } from '@/components/ui/button-ui';
import { useSession } from '@/auth/session-context';

export function FoundationView() {
  const { profile, status } = useSession();
  const navigate = useNavigate();
  const returning = Boolean(profile?.onboardingComplete);

  return <div className="landing-page">
    <aside className="landing-visual" aria-label="How learning works">
      <Link className="landing-brand" to="/"><img src="/logo.svg" alt="" /> LearningCompanion</Link>
      <div className="landing-visual-body">
        <p className="landing-visual-kicker">A clearer path through tech</p>
        <h2>Learn at your own pace.</h2>
        <p>Choose what interests you, learn through visual lessons, and revisit ideas as you grow.</p>
        <div className="landing-infographic" role="img" aria-label="Choose a topic, learn through a visual lesson, then check and review your understanding">
          <div className="landing-flow-node"><span><Compass size={32} /></span><strong>Explore</strong><small>Choose a topic</small></div>
          <ArrowRight className="landing-flow-arrow" size={24} aria-hidden="true" />
          <div className="landing-flow-node"><span><BookOpen size={32} /></span><strong>Learn</strong><small>Visual lessons</small></div>
          <ArrowRight className="landing-flow-arrow" size={24} aria-hidden="true" />
          <div className="landing-flow-node"><span><CircleCheck size={32} /></span><strong>Review</strong><small>Check your progress</small></div>
        </div>
        <div className="landing-steps"><span><b>01</b> Browse the skill tree</span><span><b>02</b> Follow guided steps</span><span><b>03</b> Revisit what matters</span></div>
      </div>
      <p className="landing-visual-footer">Build understanding that lasts.</p>
    </aside>
    <section className="landing-entry" aria-labelledby="intro-heading">
      <div className="landing-entry-inner">
        <p className="landing-entry-kicker">YOUR LEARNING STARTS HERE</p>
        <h1 id="intro-heading">Connect concepts.<br />Build understanding.</h1>
        <p className="landing-entry-description">Explore the learning tree, follow short visual lessons, and check your understanding along the way.</p>
        <div className="landing-auth-card">
          <div className="auth-panel">
            <h2>{returning ? 'Welcome back' : 'Start learning'}</h2>
            <p>{returning ? 'Pick up where you left off.' : 'No account needed. Choose your interests and start your first lesson.'}</p>
            <ButtonUi className="landing-google-button" type="button" disabled={status === 'loading'}
              onClick={() => navigate(returning ? '/home' : '/onboarding')}>
              {status === 'loading' ? 'Getting ready…' : returning ? 'Continue learning' : 'Start learning'} <ArrowRight size={18} aria-hidden="true" />
            </ButtonUi>
            {status === 'unavailable' && <p role="alert" className="mt-4 text-destructive">Learning is unavailable right now. Please try again later.</p>}
          </div>
        </div>
        <p className="landing-entry-footer">Your progress is saved in this browser.</p>
      </div>
    </section>
  </div>;
}
