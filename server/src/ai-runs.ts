import { sharedPool } from './db.js';
import type { SmokeOutput } from './ai.js';

type PublicQuestion = Omit<SmokeOutput['questions'][number], 'correctOptionId' | 'feedbackCriteria'>;
type Source = { id: string; url: string; heading: string };
export type SgDateTime = { date: string; time: string; timeZone: 'SGT' };
export type LocalSmokeRunSummary = { id: string; completedAt: SgDateTime; url: string };
export type LocalSmokeRun = {
  id: string;
  startedAt: SgDateTime;
  completedAt: SgDateTime;
  lesson: SmokeOutput['lesson'];
  questions: PublicQuestion[];
  sources: Source[];
};
export type LocalRunsService = {
  list(): Promise<LocalSmokeRunSummary[]>;
  get(id: string): Promise<LocalSmokeRun | null>;
};

export function formatSgDateTime(value: Date | string): SgDateTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return { date: `${part('day')}${part('month')}${part('year')}`,
    time: `${part('hour')}:${part('minute')}:${part('second')}`, timeZone: 'SGT' };
}

export function safeSmokeRun(id: string, output: SmokeOutput, startedAt: Date | string,
  completedAt: Date | string, sources: Source[]): LocalSmokeRun {
  return {
    id, startedAt: formatSgDateTime(startedAt), completedAt: formatSgDateTime(completedAt),
    lesson: output.lesson,
    questions: output.questions.map(({ id: questionId, prompt, kind, objectiveId, citationChunkIds, options }) =>
      ({ id: questionId, prompt, kind, objectiveId, citationChunkIds, options })),
    sources,
  };
}

export function createLocalRunsService(databaseUrl: string): LocalRunsService & { close(): Promise<void> } {
  // This reads private operation results only for the loopback development backend.
  const pool = sharedPool(databaseUrl);
  return {
    async list(): Promise<LocalSmokeRunSummary[]> {
      const saved = await pool.query<{ id: string; completed_at: Date }>(`
        select r.id, r.created_at as completed_at
        from app_private.operation_results r
        join app_private.operation_requests o on o.id=r.operation_id
        where o.operation_kind='stage5_source_smoke' and o.state='completed'
        order by r.created_at desc, r.id desc limit 20`);
      return saved.rows.map(row => ({ id: row.id, completedAt: formatSgDateTime(row.completed_at),
        url: `/api/runs/${row.id}` }));
    },
    async get(id: string): Promise<LocalSmokeRun | null> {
      const saved = await pool.query<{
        id: string; validated_payload: SmokeOutput; started_at: Date; completed_at: Date;
      }>(`
        select r.id, r.validated_payload, o.created_at as started_at, r.created_at as completed_at
        from app_private.operation_results r
        join app_private.operation_requests o on o.id=r.operation_id
        where r.id=$1 and o.operation_kind='stage5_source_smoke' and o.state='completed'`, [id]);
      const row = saved.rows[0];
      if (!row) return null;
      const output = row.validated_payload;
      const citedIds = [...new Set([
        ...output.lesson.steps.flatMap(step => step.citationChunkIds),
        ...output.questions.flatMap(question => question.citationChunkIds),
      ])];
      const sources = citedIds.length ? await pool.query<Source>(`
        select ch.id, ch.heading, s.canonical_url as url
        from public.source_chunks ch
        join public.source_revisions revision on revision.id=ch.revision_id
        join public.sources s on s.id=revision.source_id
        where ch.id=any($1) order by s.canonical_url, ch.ordinal`, [citedIds]) : null;
      return safeSmokeRun(row.id, output, row.started_at, row.completed_at, sources?.rows ?? []);
    },
    close: async () => undefined, // shared pool is closed once at shutdown
  };
}
