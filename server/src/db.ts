import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg, { type Pool, type PoolClient } from 'pg';

// One small pool per process: Cloud Run runs at most 2 instances and Neon's free tier has
// a low connection limit. Every service shares this pool.
const pools = new Map<string, Pool>();
export function sharedPool(databaseUrl: string): Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    // TLS settings come from the URL (Neon: ?sslmode=require).
    pool = new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 5),
      idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
    pool.on('error', error => console.error(`Idle database connection error: ${error.message}`));
    pools.set(databaseUrl, pool);
  }
  return pool;
}
export async function closePools() {
  await Promise.all([...pools.values()].map(pool => pool.end()));
  pools.clear();
}

const sqlFile = (name: string) => readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8');
// server/dist/db.js and server/src/db.ts both resolve to <repo>/content.
const contentFile = new URL('../../content/starter-sources.json', import.meta.url);

type StarterSource = { url: string; title: string; sourceVersion: string; conceptSlug: string; objectiveId: string;
  passages: { heading: string; text: string }[] };

// Same chunking and hashing as scripts/content-lib.mjs, so revisions stay stable.
export function chunkText(text: string, limit = 900) {
  const sentences = text.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(part => part.trim()) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > limit) { chunks.push(current); current = sentence; }
    else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}
const sourceHash = (source: StarterSource) => createHash('sha256')
  .update(JSON.stringify({ url: source.url, version: source.sourceVersion, passages: source.passages })).digest('hex');

export type Queryable = Pick<PoolClient, 'query'>;
export const readStarterSources = async () => (JSON.parse(await readFile(contentFile, 'utf8')) as { sources: StarterSource[] }).sources;
export const readSql = sqlFile;

export async function importStarterSources(db: Queryable, sources: StarterSource[]) {
  for (const source of sources) {
    const concept = await db.query<{ id: string }>('select id from public.concepts where slug=$1 and owner_id is null', [source.conceptSlug]);
    if (!concept.rows[0]) throw new Error(`Seed concept missing: ${source.conceptSlug}`);
    const conceptId = concept.rows[0].id;
    const sourceId = (await db.query<{ id: string }>(`insert into public.sources(canonical_url,title,host,permission_review,status)
      values($1,$2,$3,'allowed','draft') on conflict(canonical_url) do update set title=excluded.title,host=excluded.host,
      permission_review='allowed',updated_at=now() returning id`, [source.url, source.title, new URL(source.url).hostname])).rows[0]!.id;
    const revisionId = (await db.query<{ id: string }>(`insert into public.source_revisions(source_id,content_hash,source_version,review_state,reviewed_at)
      values($1,$2,$3,'approved',now()) on conflict(source_id,content_hash) do update set review_state='approved'
      returning id`, [sourceId, sourceHash(source), source.sourceVersion])).rows[0]!.id;
    await db.query('insert into public.source_concepts(source_id,concept_id) values($1,$2) on conflict do nothing', [sourceId, conceptId]);
    let ordinal = 0;
    for (const passage of source.passages) for (const body of chunkText(passage.text)) {
      const chunkId = (await db.query<{ id: string }>(`insert into public.source_chunks(revision_id,heading,ordinal,body)
        values($1,$2,$3,$4) on conflict(revision_id,ordinal) do update set heading=excluded.heading,body=excluded.body
        returning id`, [revisionId, passage.heading, ordinal++, body])).rows[0]!.id;
      await db.query('insert into public.chunk_concepts(chunk_id,concept_id,objective_id) values($1,$2,$3) on conflict do nothing',
        [chunkId, conceptId, source.objectiveId]);
    }
    await db.query(`update public.sources set active_revision_id=$2,status='approved',updated_at=now()
      where id=$1 and active_revision_id is distinct from $2`, [sourceId, revisionId]);
  }
}

/**
 * Creates/updates the schema and the starter catalogue. Safe to run on every start and
 * from several instances at once: one transaction serialised by an advisory lock, and
 * every statement is idempotent. The operator only provides an empty Neon database.
 */
export async function bootstrapDatabase(pool: Pool) {
  const [schema, seed, sources] = await Promise.all([sqlFile('schema.sql'), sqlFile('seed.sql'), readStarterSources()]);
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("select pg_advisory_xact_lock(hashtext('learning-companion-bootstrap'))");
    await db.query(schema);
    await db.query(seed);
    await importStarterSources(db, sources);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  } finally { db.release(); }
}
