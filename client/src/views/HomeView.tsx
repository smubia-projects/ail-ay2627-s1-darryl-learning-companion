import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, BookOpen, BrainCircuit, CalendarDays, ChartNoAxesCombined, CircleHelp, Cloud, Code2, Cpu, Database, Minus, MonitorCog, Network, PanelsTopLeft, Plus, Shield, Sparkles, UserRound, X } from 'lucide-react';
import { learningStatusLabels } from '@learning-companion/shared';
import { useSession } from '@/auth/session-context';
import { discoverTopicSources, fetchHome, fetchTopics, suggestTopics, type ConceptChoice, type HomeData, type SavedTopicNode } from '@/lib/learning';
import ContributionSkyline from '@/components/ui/contribution-skyline';
import { ButtonUi, ButtonUiLink } from '@/components/ui/button-ui';
import { startLesson } from '@/lib/sessions';
import { handledByGate } from '@/lib/api';

const areaNames: Record<string, string> = { web_communication: 'WEB COMMUNICATION', apis: 'APIs', databases: 'DATABASES' };
const skillBranches = [
  { title: 'Software Development', icon: Code2, lessons: ['what-an-api-does'] },
  { title: 'AI Engineering', icon: BrainCircuit, lessons: [] },
  { title: 'Cybersecurity', icon: Shield, lessons: [] },
  { title: 'Cloud Computing', icon: Cloud, lessons: [] },
  { title: 'Data Science and Analytics', icon: ChartNoAxesCombined, lessons: [] },
  { title: 'Databases and Data Engineering', icon: Database, lessons: ['tables-and-records'] },
  { title: 'Computer Networks', icon: Network, lessons: ['clients-and-servers', 'http-requests-and-responses'] },
  { title: 'Operating Systems', icon: MonitorCog, lessons: [] },
  { title: 'Hardware and Embedded Systems', icon: Cpu, lessons: [] },
  { title: 'Human-Computer Interaction', icon: PanelsTopLeft, lessons: [] },
];
const treeWidth = 2400;
const statusOrder = ['not_assessed', 'explored', 'developing', 'demonstrated_understanding'] as const;
function TopicExpansionButton({ topic, onOpen }: { topic: string; onOpen: (trigger: HTMLButtonElement) => void }) {
  return <button className="skill-expand-button" type="button" aria-label={`Learn something new from ${topic}`} onClick={event => onOpen(event.currentTarget)}>
    <Plus size={17} aria-hidden="true" /><span role="tooltip">Learn something new</span>
  </button>;
}
function useHomeData() {
  const { session } = useSession();
  return useQuery({ queryKey: ['home', session?.userId], queryFn: fetchHome, enabled: Boolean(session) });
}
function LessonAction({ concept }: { concept: ConceptChoice }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef<string | null>(null);

  if (concept.sessionId) return <ButtonUiLink to={`/learn/${concept.sessionId}`}>
    {concept.sessionCompleted ? 'Review lesson again' : 'Resume lesson'}
  </ButtonUiLink>;
  if (!concept.contentAvailable) return <p className="skill-lesson-unavailable">Lesson unavailable right now.</p>;

  async function start() {
    setStarting(true); setError(false);
    try {
      requestId.current ??= crypto.randomUUID();
      const saved = await startLesson(concept.id, requestId.current);
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      navigate(`/learn/${saved.id}`);
    } catch (caught) { if (!handledByGate(caught)) setError(true); }
    finally { setStarting(false); }
  }
  return <div className="skill-lesson-action"><ButtonUi disabled={starting} onClick={() => { void start(); }}>{starting ? 'Preparing lesson…' : 'Start lesson'}</ButtonUi>
    {starting && <p role="status" className="skill-lesson-progress">Writing a new lesson can take a few minutes. Please keep this tab open.</p>}
    {error && <p role="alert">Could not prepare your lesson. <ButtonUi variant="quiet" size="small" onClick={() => { void start(); }}>Try again</ButtonUi></p>}
  </div>;
}
function SuggestedLessonAction({ topic }: { topic: SavedTopicNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<'sources' | 'lesson' | null>(null);
  const [error, setError] = useState(false);
  if (topic.sessionId) return <ButtonUiLink to={`/learn/${topic.sessionId}`}>
    {topic.status === 'explored' ? 'Resume Lesson' : 'Review Lesson Again'}
  </ButtonUiLink>;
  async function learn() {
    setPhase('sources'); setError(false);
    try {
      const result = await discoverTopicSources(topic.id);
      if (!result.ready) { setError(true); return; }
      setPhase('lesson');
      const saved = await startLesson(topic.id, crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: ['topics'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      navigate(`/learn/${saved.id}`);
    }
    catch (caught) { if (!handledByGate(caught)) setError(true); }
    finally { setPhase(null); }
  }
  return <div className="skill-lesson-action">
    <ButtonUi disabled={phase !== null} onClick={() => { void learn(); }}>{phase === 'sources' ? 'Finding sources…' : phase === 'lesson' ? 'Preparing lesson…' : 'Learn'}</ButtonUi>
    {phase !== null && <p role="status" className="skill-lesson-progress">Finding sources and writing a new lesson can take a few minutes. Please keep this tab open.</p>}
    {error && <p role="alert">Could not prepare this lesson. <ButtonUi variant="quiet" size="small" onClick={() => { void learn(); }}>Try again</ButtonUi></p>}
  </div>;
}
function ActivityPanel({ data }: { data: HomeData }) {
  return <section className="activity-panel" aria-labelledby="activity-heading">
    <div className="section-heading"><div><span className="eyebrow"><CalendarDays size={14} /> LEARNING HISTORY</span><h2 id="activity-heading">Your activity</h2><p>Lesson sessions started per day over the past year.</p></div></div>
    <div className="activity-chart-section"><ContributionSkyline activityCounts={data.activityCounts} /></div>
  </section>;
}
function ConceptCard({ concept, reason, dueAt }: { concept: ConceptChoice; reason?: string; dueAt?: string | null }) {
  return <div className="concept-row compact"><div className="concept-icon"><Network size={20} /></div><div><span className="concept-area">{areaNames[concept.area]}</span><h3>{concept.title}</h3><span className="status-text">{reason ?? learningStatusLabels[concept.status as keyof typeof learningStatusLabels] ?? 'Not assessed'}{dueAt ? ` Suggested review date: ${new Date(dueAt).toLocaleDateString()}.` : ''}</span></div>
    {concept.sessionId && <ButtonUiLink variant="outline" size="small" to={`/learn/${concept.sessionId}`} aria-label={`Review ${concept.title}`}>Review lesson</ButtonUiLink>}
  </div>;
}
export function HomeView() {
  const { session } = useSession();
  const { data, isLoading, isError, refetch } = useHomeData();
  const topics = useQuery({ queryKey: ['topics', session?.userId], queryFn: fetchTopics, enabled: Boolean(session) });
  if (isLoading) return <p className="load-state" role="status">Loading your home…</p>;
  if (isError || !data) return <div className="load-state" role="alert">Could not load your home. <ButtonUi variant="quiet" size="small" onClick={() => { void refetch(); }}>Try again</ButtonUi></div>;
  const recommended = data.concepts.find(item => item.id === data.recommendations.learn?.conceptId);
  const unfinished = data.unfinishedSession;
  const unfinishedTitle = data.concepts.find(item => item.id === unfinished?.conceptId)?.title ?? topics.data?.find(item => item.id === unfinished?.conceptId)?.title;
  const review = data.recommendations.review.map(item => ({ ...item, concept: data.concepts.find(concept => concept.id === item.conceptId) })).filter(item => item.concept);
  return <div className="home-view">
    <div className="page-intro"><span className="eyebrow"><Sparkles size={14} /> YOUR LEARNING SPACE</span><h1>Welcome back<span className="wave">✦</span></h1><p>Build connections, one concept at a time. Choose a path that feels right today.</p></div>
    <div className="home-grid">
      <section className="feature-card learn-card" aria-labelledby="learn-heading"><div className="card-topline"><span className="pill cyan">{unfinished ? 'CONTINUE LEARNING' : 'LEARN SOMETHING NEW'}</span>{recommended && !unfinished && <span className="pill subdued">ABOUT 15 MIN</span>}</div>
        {unfinished ? <><h2 id="learn-heading">{unfinishedTitle ?? 'Continue your lesson'}</h2><p>Pick up where you left off.</p><div className="card-footer"><ButtonUiLink to={`/learn/${unfinished.id}`}>Continue lesson</ButtonUiLink></div></> :
          recommended ? <><h2 id="learn-heading">{recommended.title}</h2><p>{data.recommendations.learn?.reason}</p>{recommended.objectives[0] && <div className="home-topic-list"><div className="concept-row compact"><BookOpen size={20} aria-hidden="true" /><div><span className="concept-area">WHAT YOU'LL LEARN</span><h3>{recommended.objectives[0]}</h3></div></div></div>}<div className="card-footer"><LessonAction concept={recommended} /></div></> :
          <><h2 id="learn-heading">Explore what interests you</h2><p>Choose an area in Learn to find a topic you want to explore.</p><div className="card-footer"><ButtonUiLink to="/learn">Go to Learn</ButtonUiLink></div></>}
      </section>
      <section className="feature-card review-card" aria-labelledby="review-heading"><div className="card-topline"><span className="pill violet">REVIEW</span><span className="pill subdued">YOUR PACE</span></div><h2 id="review-heading">Strengthen what you know</h2><p>Return to explored concepts and practise gaps when you are ready.</p>
        <div className="review-list">{review.length > 0 ? review.slice(0, 2).map(item => <ConceptCard concept={item.concept!} reason={item.reason} dueAt={item.dueAt} key={item.conceptId} />) : <div className="empty-review"><CircleHelp size={24} /><span>No concepts to review yet. Your explored topics will appear here.</span></div>}</div>
      </section>
    </div>
    <ActivityPanel data={data} />
    <div className="home-bottom"><span>Your learning progress is saved.</span><Link to="/learn">View skill tree <ArrowRight size={15} /></Link></div>
  </div>;
}

function TreeChildren({ parentKey, topics, concepts = [], selectedId, onSelect, onExpand }: {
  parentKey: string; topics: SavedTopicNode[]; concepts?: ConceptChoice[]; selectedId: string | null;
  onSelect: (id: string) => void; onExpand: (key: string, title: string, trigger: HTMLButtonElement) => void;
}) {
  const children = topics.filter(topic => topic.parentKey === parentKey);
  if (!children.length && !concepts.length) return null;
  return <ul className="skill-tree-children">{concepts.map(lesson => <li className="skill-tree-item" key={lesson.id}><div className="skill-topic-node"><button className="skill-node-button" type="button" aria-pressed={selectedId === lesson.id} onClick={() => onSelect(lesson.id)}><span className="skill-hex" data-status={lesson.status}><BookOpen size={18} /></span><span>{lesson.title}</span><span className="sr-only">Learning status: {learningStatusLabels[lesson.status]}</span></button><TopicExpansionButton topic={lesson.title} onOpen={trigger => onExpand(`concept:${lesson.id}`, lesson.title, trigger)} /></div>
    <TreeChildren parentKey={`concept:${lesson.id}`} topics={topics} selectedId={selectedId} onSelect={onSelect} onExpand={onExpand} />
  </li>)}{children.map(topic => <li className="skill-tree-item" data-topic-id={topic.id} key={topic.id}>
    <div className="skill-topic-node"><button className="skill-node-button skill-generated-button" type="button"
      aria-pressed={selectedId === topic.id} onClick={() => onSelect(topic.id)}><span className="skill-hex" data-status={topic.status}><BookOpen size={18} /></span><span>{topic.title}</span><span className="sr-only">Learning status: {learningStatusLabels[topic.status]}</span></button>
      <TopicExpansionButton topic={topic.title} onOpen={trigger => onExpand(`node:${topic.id}`, topic.title, trigger)} />
    </div>
    <TreeChildren parentKey={`node:${topic.id}`} topics={topics} selectedId={selectedId} onSelect={onSelect} onExpand={onExpand} />
  </li>)}</ul>;
}

function SkillTree({ concepts, topics }: { concepts: ConceptChoice[]; topics: SavedTopicNode[] }) {
  const viewport = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const expansionTrigger = useRef<HTMLButtonElement | null>(null);
  const expansionSequence = useRef(0);
  const pendingSuggestion = useRef<{ key: string; prompt: string | undefined; id: string } | null>(null);
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandingFrom, setExpandingFrom] = useState<{ key: string; title: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);
  const [focusIds, setFocusIds] = useState<string[] | null>(() => topics.length ? [topics.at(-1)!.id] : null);
  const [expansionPosition, setExpansionPosition] = useState({ left: 12, top: 12 });
  const selected = concepts.find(concept => concept.id === selectedId);
  const selectedTopic = topics.find(topic => topic.id === selectedId);
  const openExpansion = (key: string, title: string, trigger: HTMLButtonElement) => {
    expansionSequence.current++;
    expansionTrigger.current = trigger;
    const bounds = trigger.getBoundingClientRect();
    const dialogWidth = Math.min(360, window.innerWidth - 24);
    const right = bounds.right + 12;
    setExpansionPosition({
      left: right + dialogWidth <= window.innerWidth - 12 ? right : Math.max(12, bounds.left - dialogWidth - 12),
      top: Math.max(12, Math.min(bounds.top - 20, window.innerHeight - 300)),
    });
    setSelectedId(null);
    setSuggesting(false);
    setSuggestionError(false);
    setExpandingFrom({ key, title });
  };
  const closeExpansion = () => {
    expansionSequence.current++;
    setExpandingFrom(null);
    expansionTrigger.current?.focus();
  };
  const requestSuggestions = async (prompt?: string) => {
    if (!expandingFrom || suggesting) return;
    const sequence = expansionSequence.current;
    const request = pendingSuggestion.current?.key === expandingFrom.key && pendingSuggestion.current.prompt === prompt
      ? pendingSuggestion.current : { key: expandingFrom.key, prompt, id: crypto.randomUUID() };
    pendingSuggestion.current = request;
    const requestId = request.id;
    setSuggesting(true); setSuggestionError(false);
    try {
      const saved = await suggestTopics(expandingFrom.key, requestId, prompt);
      if (pendingSuggestion.current?.id === requestId) pendingSuggestion.current = null;
      queryClient.setQueryData<SavedTopicNode[]>(['topics', session?.userId], current => [
        ...(current ?? []), ...saved.filter(topic => !current?.some(item => item.id === topic.id)),
      ]);
      if (sequence === expansionSequence.current) { setFocusIds(saved.map(topic => topic.id)); closeExpansion(); }
    }
    catch (error) {
      const uncertain = error instanceof TypeError || error instanceof DOMException
        && (error.name === 'TimeoutError' || error.name === 'AbortError');
      if (!uncertain && pendingSuggestion.current?.id === requestId) pendingSuggestion.current = null;
      if (sequence === expansionSequence.current && !handledByGate(error)) setSuggestionError(true);
      if (sequence === expansionSequence.current && handledByGate(error)) closeExpansion();
    }
    finally { if (sequence === expansionSequence.current) setSuggesting(false); }
  };

  const zoom = useCallback((factor: number, clientX: number, clientY: number) => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    setView(current => {
      const scale = Math.min(2.5, Math.max(0.4, current.scale * factor));
      return { scale, x: x - (x - current.x) * scale / current.scale, y: y - (y - current.y) * scale / current.scale };
    });
  }, []);

  useLayoutEffect(() => {
    if (!focusIds || !viewport.current || !canvas.current) return;
    const nodes = [...canvas.current.querySelectorAll<HTMLElement>('[data-topic-id]')]
      .filter(node => focusIds.includes(node.dataset.topicId ?? ''));
    if (nodes.length !== focusIds.length || !viewport.current.clientWidth || !viewport.current.clientHeight) return;
    const canvasBounds = canvas.current.getBoundingClientRect();
    const bounds = nodes.map(node => node.querySelector('.skill-topic-node')!.getBoundingClientRect());
    const left = Math.min(...bounds.map(node => (node.left - canvasBounds.left) / view.scale));
    const right = Math.max(...bounds.map(node => (node.right - canvasBounds.left) / view.scale));
    const top = Math.min(...bounds.map(node => (node.top - canvasBounds.top) / view.scale));
    const bottom = Math.max(...bounds.map(node => (node.bottom - canvasBounds.top) / view.scale));
    const scale = Math.max(0.15, Math.min(view.scale, (viewport.current.clientWidth - 80) / Math.max(right - left, 1),
      (viewport.current.clientHeight - 100) / Math.max(bottom - top, 1)));
    setView({ scale, x: (viewport.current.clientWidth - (left + right) * scale) / 2,
      y: (viewport.current.clientHeight - (top + bottom) * scale) / 2 });
    setFocusIds(null);
  }, [focusIds, topics, view.scale]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let width = element.clientWidth;
    if (!focusIds) setView(current => ({ ...current, x: (width - (canvas.current?.offsetWidth ?? treeWidth)) / 2 }));
    const resize = () => {
      const nextWidth = element.clientWidth;
      setView(current => ({ ...current, x: current.x + (nextWidth - width) / 2 }));
      width = nextWidth;
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.skill-detail-panel,.topic-expansion-overlay')) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    };
    window.addEventListener('resize', resize);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { window.removeEventListener('resize', resize); element.removeEventListener('wheel', wheel); };
  }, [zoom]);

  return <section className="skill-tree-viewport" aria-label="Skill tree" ref={viewport} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('button,.skill-detail-panel,.topic-expansion-overlay')) return;
      drag.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.classList.add('dragging');
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      drag.current = { x: event.clientX, y: event.clientY };
      setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.classList.remove('dragging'); }}
    onPointerCancel={event => { drag.current = null; event.currentTarget.classList.remove('dragging'); }}
    onKeyDown={event => {
      const moves: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      const move = (event.target as Element).closest('.skill-detail-panel,.topic-expansion-overlay') ? undefined : moves[event.key];
      if (move) { event.preventDefault(); setView(current => ({ ...current, x: current.x + move[0], y: current.y + move[1] })); }
    }}>
    <div className="skill-tree-controls"><span>Drag to move · Scroll to zoom</span>
      <button type="button" aria-label="Zoom out" onClick={() => { const bounds = viewport.current?.getBoundingClientRect(); if (bounds) zoom(1 / 1.2, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); }}><Minus size={18} /></button>
      <button type="button" aria-label="Zoom in" onClick={() => { const bounds = viewport.current?.getBoundingClientRect(); if (bounds) zoom(1.2, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); }}><Plus size={18} /></button>
    </div>
    <div className="skill-status-legend" aria-label="Learning status legend">{statusOrder.map(status => <span key={status}><i className="skill-hex" data-status={status} />{learningStatusLabels[status]}</span>)}</div>
    <div className="skill-tree-canvas" ref={canvas} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
      <div className="skill-tree-root skill-topic-node"><span className="skill-hex"><UserRound size={24} /></span><strong>You</strong></div>
      <ul className="skill-branches skill-tree-children">{skillBranches.map(branch => {
        const lessons = branch.lessons.map(slug => concepts.find(concept => concept.slug === slug)).filter((concept): concept is ConceptChoice =>
          Boolean(concept && (concept.sessionId || topics.some(topic => topic.parentKey === `concept:${concept.id}`))));
        return <li className="skill-branch skill-tree-item" key={branch.title}><div className="skill-topic-node"><span className="skill-hex"><branch.icon size={21} /></span><h2>{branch.title}</h2><TopicExpansionButton topic={branch.title} onOpen={trigger => openExpansion(`root:${branch.title}`, branch.title, trigger)} /></div>
          <TreeChildren parentKey={`root:${branch.title}`} topics={topics} concepts={lessons} selectedId={selectedId} onSelect={setSelectedId} onExpand={openExpansion} />
        </li>;
      })}</ul>
    </div>
    {selected && <aside className="skill-detail-panel" aria-labelledby="skill-detail-title"><div className="skill-detail-head"><span className="eyebrow">LESSON DETAILS</span><span className="skill-status-badge" data-status={selected.status}>{learningStatusLabels[selected.status]}</span></div>
      <button type="button" className="skill-detail-close" aria-label="Close lesson details" onClick={() => setSelectedId(null)}><X size={19} /></button>
      <h2 id="skill-detail-title">{selected.title}</h2><p>{selected.description ?? 'Description unavailable.'}</p>
      <section className="skill-detail-section"><h3>Objectives</h3>
        {selected.objectives.length ? <ul>{selected.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul> : <p>Objectives unavailable.</p>}
      </section>
      <section className="skill-detail-section"><h3>Citations</h3>
        {selected.citations.length ? <ul>{selected.citations.map(citation => <li key={citation.url}>{/^https?:\/\//i.test(citation.url) ? <a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.title} ↗</a> : citation.title}</li>)}</ul> : <p>No citations available yet.</p>}
      </section>
      <div className="skill-detail-action"><LessonAction key={selected.id} concept={selected} /></div>
    </aside>}
    {selectedTopic && <aside className="skill-detail-panel" aria-labelledby="skill-detail-title"><div className="skill-detail-head"><span className="eyebrow">TOPIC</span><span className="skill-status-badge" data-status={selectedTopic.status}>{learningStatusLabels[selectedTopic.status]}</span></div>
      <button type="button" className="skill-detail-close" aria-label="Close topic details" onClick={() => setSelectedId(null)}><X size={19} /></button>
      <h2 id="skill-detail-title">{selectedTopic.title}</h2><section className="skill-detail-section"><h3>Learning objective</h3><p>{selectedTopic.objective}</p></section>
      <section className="skill-detail-section"><h3>Citations</h3>
        {selectedTopic.citations.length ? <ul>{selectedTopic.citations.map(citation => <li key={citation.url}><a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.title} ↗</a></li>)}</ul> : <p>No citations available yet.</p>}
      </section>
      <div className="skill-detail-action"><SuggestedLessonAction key={selectedTopic.id} topic={selectedTopic} /></div>
    </aside>}
    {expandingFrom && <div className="topic-expansion-overlay" onClick={event => { if (!suggesting && event.target === event.currentTarget) closeExpansion(); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !suggesting) closeExpansion();
    }}><div className="topic-expansion-dialog" data-loading={suggesting} role="dialog" aria-modal="true" aria-busy={suggesting} aria-labelledby="topic-expansion-title" style={expansionPosition}><button type="button" className="topic-expansion-close" aria-label="Close" autoFocus disabled={suggesting} onClick={closeExpansion}><X size={20} /></button><h2 id="topic-expansion-title">What do you want to learn?</h2><form className="topic-expansion-form" inert={suggesting} onSubmit={event => { event.preventDefault(); const prompt = String(new FormData(event.currentTarget).get('topic') ?? '').trim(); if (prompt) void requestSuggestions(prompt); }}><label className="sr-only" htmlFor="topic-expansion-input">Topic</label><input id="topic-expansion-input" name="topic" type="text" maxLength={300} placeholder="Type a topic or concept..." disabled={suggesting} /><a href="#suggest" onClick={event => { event.preventDefault(); void requestSuggestions(); }}>Got nothing in mind? Let me suggest for you</a><button type="submit" disabled={suggesting}>Submit</button></form>{suggesting && <div className="topic-expansion-loading" role="status"><span className="topic-expansion-spinner" aria-hidden="true" />Finding topics…</div>}{suggestionError && <p role="alert">Could not suggest topics. Please try again.</p>}</div></div>}
  </section>;
}

export function CatalogueView() {
  const { session } = useSession();
  const { data, isLoading, isError, refetch } = useHomeData();
  const topics = useQuery({ queryKey: ['topics', session?.userId], queryFn: fetchTopics, enabled: Boolean(session) });
  return <div className="catalogue-view"><div className="page-intro"><span className="eyebrow">EXPLORE THE CATALOGUE</span><h1>Choose what to learn</h1><p>Start with a recommendation or follow your curiosity.</p></div>
    {isLoading || topics.isLoading ? <p className="load-state" role="status">Loading topics…</p> : isError || !data || topics.isError ? <div className="load-state" role="alert">Could not load topics. <ButtonUi variant="quiet" size="small" onClick={() => { void refetch(); void topics.refetch(); }}>Try again</ButtonUi></div> : <SkillTree concepts={data.concepts} topics={topics.data ?? []} />}
  </div>;
}
