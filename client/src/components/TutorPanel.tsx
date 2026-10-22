import { useEffect, useRef, useState } from 'react';
import { handledByGate } from '@/lib/api';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import type { TutorHistory, TutorMessage } from '@learning-companion/shared';
import { ButtonUi } from '@/components/ui/button-ui';
import { fetchTutorHistory, sendTutorMessage } from '@/lib/sessions';

export function TutorPanel({ sessionId, stepId, citations, annotation, onClearAnnotation, onHighlights }: {
  sessionId: string; stepId?: string; citations: { id: string; heading: string; url: string }[];
  annotation?: string | undefined; onClearAnnotation?: () => void;
  onHighlights?: (message: TutorMessage) => void;
}) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ['tutor', sessionId], initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => fetchTutorHistory(sessionId, pageParam ?? undefined),
    getNextPageParam: page => page.nextBefore ?? undefined,
  });
  const messages = history.data ? [...history.data.pages].reverse().flatMap(page => page.messages) : [];
  const latestReply = [...messages].reverse().find(message => message.role === 'assistant');

  useEffect(() => { if (annotation) input.current?.focus(); }, [annotation]);
  useEffect(() => { if (latestReply && latestReply.stepId === stepId) onHighlights?.(latestReply); }, [latestReply, onHighlights, stepId]);

  async function send() {
    const message = question.trim();
    if (!message || sending.current) return;
    sending.current = true; setPending(true); setSendError(false);
    try {
      const saved = await sendTutorMessage(sessionId, { message, ...(annotation && { selectedText: annotation }),
        ...(stepId && { stepId }), requestId: crypto.randomUUID() });
      queryClient.setQueryData<InfiniteData<TutorHistory, number | null>>(['tutor', sessionId], old => old ? {
        ...old, pages: old.pages.map((page, index) => index === 0 && !page.messages.some(item => item.id === saved.reply.id)
          ? { ...page, messages: [...page.messages, saved.userMessage, saved.reply] } : page),
      } : { pages: [{ messages: [saved.userMessage, saved.reply], nextBefore: null }], pageParams: [null] });
      setQuestion(''); onClearAnnotation?.();
    } catch (caught) { if (!handledByGate(caught)) setSendError(true); }
    finally { sending.current = false; setPending(false); }
  }

  return <aside className="tutor-panel" aria-label="Tutor chat">
    <div className="tutor-panel-heading"><span className="tutor-avatar" aria-hidden="true">✦</span><div><span className="eyebrow">YOUR TUTOR</span><h2>Ask Tutor</h2></div></div>
    <div className="tutor-messages" aria-live="polite">
      {history.hasNextPage && <ButtonUi type="button" variant="quiet" size="small" disabled={history.isFetchingNextPage}
        onClick={() => { void history.fetchNextPage(); }}>{history.isFetchingNextPage ? 'Loading…' : 'Earlier messages'}</ButtonUi>}
      <div className="tutor-message tutor-message-ai">Ask or highlight a text to clarify anything here!</div>
      {history.isLoading && <p role="status" className="tutor-status">Opening your conversation…</p>}
      {history.isError && <p role="alert" className="tutor-status">Could not load your conversation. <ButtonUi type="button" variant="quiet" size="small" onClick={() => { void history.refetch(); }}>Try again</ButtonUi></p>}
      {messages.map(message => <div className={`tutor-message tutor-message-${message.role === 'assistant' ? 'ai' : 'user'}`} key={message.id}>
        {message.selectedText && <blockquote>{message.selectedText}</blockquote>}{message.body}
        {message.role === 'assistant' && message.sourceMode === 'unverified' && <span className="tutor-source-mode">Unverified explanation</span>}
        {message.role === 'assistant' && message.citationChunkIds.length > 0 && <span className="tutor-citations">Sources: {message.citationChunkIds.map((id, index) => {
          const citation = citations.find(item => item.id === id);
          return citation && /^https?:\/\//i.test(citation.url) ? <a key={id} href={citation.url} target="_blank" rel="noopener noreferrer">{citation.heading}{index < message.citationChunkIds.length - 1 ? ', ' : ''}</a> : citation?.heading ?? 'Saved source';
        })}</span>}
      </div>)}
      {pending && <p role="status" className="tutor-status">Tutor is thinking…</p>}
    </div>
    <form className="tutor-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
      {annotation && <div className="tutor-annotation"><span>Selected text</span><blockquote>{annotation}</blockquote>
        <ButtonUi type="button" variant="quiet" size="small" disabled={pending} onClick={onClearAnnotation}>Remove selection</ButtonUi></div>}
      <label htmlFor="tutor-question">Your question</label>
      <div className="tutor-input-row"><textarea id="tutor-question" ref={input} value={question} onChange={event => setQuestion(event.target.value)}
        placeholder="What would you like to ask?" rows={3} maxLength={2000} disabled={pending || history.isError || history.isLoading} />
        <button className="tutor-send" type="submit" aria-label={pending ? 'Sending message' : 'Send message'} disabled={!question.trim() || pending || history.isError || history.isLoading}>
          {pending ? <LoaderCircle className="tutor-spinner" size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button></div>
      {sendError && <p role="alert" className="form-error">Could not send your question. Please try again.</p>}
    </form>
  </aside>;
}
