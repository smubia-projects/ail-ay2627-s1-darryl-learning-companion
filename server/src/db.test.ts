import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importStarterSources, readSql, readStarterSources, type Queryable } from './db.js';

// Embedded PostgreSQL stands in for Neon: the same schema, seed and starter-source import
// the API runs at startup (bootstrapDatabase), applied twice to prove they are idempotent.
const a = '00000000-0000-4000-8000-000000000901';
const b = '00000000-0000-4000-8000-000000000902';
const conceptId = '00000000-0000-4000-8000-000000000101';
let db: PGlite;

async function bootstrap() {
  await db.exec(await readSql('schema.sql'));
  await db.exec(await readSql('seed.sql'));
  await importStarterSources(db as unknown as Queryable, await readStarterSources());
}
const count = async (sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

beforeAll(async () => {
  db = new PGlite();
  await bootstrap();
  await bootstrap();
}, 60_000);
afterAll(async () => { await db.close(); });

describe('Neon schema bootstrap', () => {
  it('seeds the catalogue and starter sources once, however often it runs', async () => {
    expect(await count('select count(*)::int as n from public.concepts')).toBe(12);
    expect(await count('select count(*)::int as n from public.concept_edges')).toBe(13);
    expect(await count('select count(*)::int as n from public.source_revisions')).toBe(
      await count('select count(*)::int as n from public.sources'));
    const available = (await db.query<{ id: string }>('select id from public.available_lesson_concepts() as id')).rows;
    expect(available).toHaveLength(4);
    const passages = await db.query(`select * from public.find_approved_lesson_passages($1,$2,$3)`,
      [conceptId, ['client-server-roles'], 'clients and servers browser request']);
    expect(passages.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('grades answers per visitor and records explored and completed progress', async () => {
    await db.query('insert into public.profiles(user_id) values ($1),($2)', [a, b]);
    const sessionId = randomUUID();
    const roundId = randomUUID();
    const questions = [0, 1, 2].map(i => ({ id: `q-${i}`, familyId: `family-${i}`, prompt: `Question ${i}`,
      kind: i === 2 ? 'application' : 'recall', objectiveIds: ['client-server-roles'], citationChunkIds: [],
      options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }));
    await db.query(`insert into public.lesson_sessions(id,owner_id,concept_id,mode,generation_state,lesson,source_mode)
      values ($1,$2,$3,'learn','ready','{"steps":[]}','source_grounded')`, [sessionId, a, conceptId]);
    expect((await db.query<{ learning_status: string }>('select learning_status from public.user_concept_progress where owner_id=$1', [a])).rows)
      .toEqual([{ learning_status: 'explored' }]);
    await expect(db.query(`insert into public.assessment_rounds(id,session_id,owner_id,kind,questions,source_mode,assessment_basis)
      values ($1,$2,$3,'initial',$4,'source_grounded','ai_generated_key')`,
    [randomUUID(), sessionId, a, JSON.stringify(questions.map((q, i) => i ? q : { ...q, correctOptionId: 'a' }))])).rejects.toThrow('non-public');
    await db.query(`insert into public.assessment_rounds(id,session_id,owner_id,kind,questions,source_mode,assessment_basis)
      values ($1,$2,$3,'initial',$4,'source_grounded','ai_generated_key')`, [roundId, sessionId, a, JSON.stringify(questions)]);
    await db.query('insert into app_private.assessment_secrets(round_id,answer_keys) values ($1,$2)',
      [roundId, JSON.stringify({ 'q-0': 'a', 'q-1': 'a', 'q-2': 'a' })]);

    // Another visitor cannot answer this visitor's round.
    await expect(db.query('select public.submit_mcq_answer($1,$2,$3,$4,$5)', [b, roundId, 'q-0', 'a', randomUUID()]))
      .rejects.toThrow('Round not found');
    const hint = (await db.query<{ r: { assisted: boolean } }>('select public.request_mcq_hint($1,$2,$3,$4) as r',
      [a, roundId, 'q-1', randomUUID()])).rows[0]!.r;
    expect(hint.assisted).toBe(true);
    const first = (await db.query<{ r: { completed: boolean; evidence: { independent: boolean } } }>(
      'select public.submit_mcq_answer($1,$2,$3,$4,$5) as r', [a, roundId, 'q-0', 'a', randomUUID()])).rows[0]!.r;
    expect(first).toMatchObject({ completed: false, evidence: { independent: true } });
    await db.query('select public.submit_mcq_answer($1,$2,$3,$4,$5)', [a, roundId, 'q-1', 'a', randomUUID()]);
    const final = (await db.query<{ r: { completed: boolean; progressUpdate: { currentStatus: string } } }>(
      'select public.submit_mcq_answer($1,$2,$3,$4,$5) as r', [a, roundId, 'q-2', 'a', randomUUID()])).rows[0]!.r;
    // The hinted question is assisted, so the check completes as "developing".
    expect(final).toMatchObject({ completed: true, progressUpdate: { currentStatus: 'developing' } });
    expect(await count('select count(*)::int as n from public.lesson_sessions where id=$1 and completed_at is not null', [sessionId])).toBe(1);
    expect(await count('select count(*)::int as n from public.user_concept_progress where owner_id=$1', [b])).toBe(0);
  });
});
