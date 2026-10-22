import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { lessonSchema } from '@learning-companion/shared';
import { enrichLessonContent, mergeLessonContent } from './lesson-content.js';

const chunkId = '00000000-0000-4000-8000-000000000501';
const lesson = lessonSchema.parse({
  id: '00000000-0000-4000-8000-000000000201', conceptId: '00000000-0000-4000-8000-000000000101',
  title: 'Client and server', sourceMode: 'source_grounded', contentVersion: 'source-v1',
  runningExample: 'Ada opens /courses to see the courses offered by the course website.',
  objectives: [{ id: 'roles', description: 'Explain client and server roles.' }], citationChunkIds: [chunkId],
  diagrams: [{ id: 'flow', type: 'flow', title: 'Opening courses', nodes: [
    { id: 'browser', label: 'Browser', example: 'Open /courses', description: 'Requests the course page.' },
    { id: 'server', label: 'Course website', example: 'Courses page', description: 'Returns the course page.' },
  ], edges: [{ id: 'request', from: 'browser', to: 'server', label: 'Request /courses' }] }],
  steps: Array.from({ length: 4 }, (_, i) => ({ id: `step${i}`, heading: 'Opening courses',
    caption: 'Ada requests the courses page.',
    explanation: 'The browser begins this exchange by asking the server for the courses page. The server receives the request and can return the page.',
    workedExample: 'Ada opens /courses in the browser. The course website returns the requested page for the browser to display.',
    commonMistake: 'Mistake: the server starts this exchange. Correction: the browser sends the request first.',
    diagramId: 'flow', highlightNodeIds: ['browser'], highlightEdgeIds: ['request'], highlightRowIndexes: [], citationChunkIds: [chunkId],
  })),
});
const passages = [{ id: chunkId, body: 'A browser requests a page from a server. The server responds with the requested page.' }];
const content = { steps: lesson.steps.map(step => ({ id: step.id, caption: step.caption,
  explanation: `${step.explanation}\n\nFollow Ada's /courses request from the browser to the course website in the diagram.`,
  workedExample: step.workedExample, commonMistake: step.commonMistake })) };

describe('in-place lesson explanations', () => {
  it('changes only text while preserving diagrams, source context and step identities', async () => {
    const provider = vi.fn(async (_prompt: string) => JSON.stringify(content));
    const enriched = await enrichLessonContent(lesson, passages, provider);
    expect(enriched).toEqual({ ...lesson, steps: lesson.steps.map((step, index) => ({ ...step, ...content.steps[index] })) });
    expect(enriched.diagrams).toEqual(lesson.diagrams);
    expect(provider.mock.calls[0]?.[0]).toContain('/courses');
    expect(JSON.stringify(enriched)).not.toContain('correctOptionId');
  });
  it('rejects changed IDs, injected diagrams, missing sources and unsupported claims', () => {
    expect(() => mergeLessonContent(lesson, { steps: content.steps.slice(1) }, passages)).toThrow();
    expect(() => mergeLessonContent(lesson, { ...content, diagrams: [] }, passages)).toThrow();
    expect(() => mergeLessonContent(lesson, { steps: content.steps.map(step => ({ ...step, id: 'other' })) }, passages)).toThrow();
    expect(() => mergeLessonContent(lesson, content, [])).toThrow();
    expect(() => mergeLessonContent(lesson, { steps: content.steps.map(step => ({ ...step, caption: 'The server always responds.' })) }, passages)).toThrow();
  });
  it('allows text updates in PostgreSQL while protecting diagram and source context', async () => {
    const db = new PGlite();
    try {
      await db.exec(await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../sql/seed.sql', import.meta.url), 'utf8'));
      const owner = '00000000-0000-4000-8000-000000000901';
      await db.query('insert into public.profiles(user_id) values ($1)', [owner]);
      await db.query(`insert into public.lesson_sessions(id,owner_id,concept_id,mode,generation_state,source_mode,citation_snapshot,content_version,lesson,current_step)
        values ($1,$2,$3,'learn','ready','source_grounded','[]','v1',$4,2)`, [lesson.id, owner, lesson.conceptId, JSON.stringify(lesson)]);
      const enriched = mergeLessonContent(lesson, content, passages);
      await db.query('update public.lesson_sessions set lesson=$1 where id=$2', [JSON.stringify(enriched), lesson.id]);
      const saved = (await db.query<{ lesson: unknown; current_step: number }>('select lesson,current_step from public.lesson_sessions')).rows[0]!;
      expect(saved).toEqual({ lesson: enriched, current_step: 2 });
      for (const changed of [ { ...enriched, diagrams: [] }, { ...enriched, runningExample: 'Different example' },
        { ...enriched, steps: enriched.steps.map(step => ({ ...step, citationChunkIds: [] })) } ]) {
        await expect(db.query('update public.lesson_sessions set lesson=$1 where id=$2', [JSON.stringify(changed), lesson.id])).rejects.toThrow('immutable');
      }
      await expect(db.query("update public.lesson_sessions set source_mode='unverified' where id=$1", [lesson.id])).rejects.toThrow('immutable');
      expect((await db.query('select count(*)::int as n from public.lesson_sessions')).rows[0]).toEqual({ n: 1 });
    } finally { await db.close(); }
  });
});
