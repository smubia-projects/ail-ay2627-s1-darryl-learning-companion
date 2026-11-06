import type { Pool, PoolClient } from 'pg';
import { closePools, sharedPool } from './db.js';
import { AiOperationError, type AiStore, type OperationRecord, type SmokeOutput } from './ai.js';

const kind = 'stage5_source_smoke';
function limit(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) throw new AiOperationError('CONFIGURATION', `${name} must be a positive integer.`);
  return parsed;
}
export async function transaction<T>(pool: Pool, action: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    const result = await action(db);
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally { db.release(); }
}
export async function reserveCall(db: PoolClient, ownerId: string, isAnonymous: boolean) {
  const day = (await db.query<{ day: string }>("select (now() at time zone 'Asia/Singapore')::date::text as day")).rows[0]?.day;
  if (!day) throw new AiOperationError('PROVIDER_FAILURE', 'Could not determine quota day.');
  const limits = new Map<string, number>([
    ['deployment', limit('AI_DEPLOYMENT_DAILY_LIMIT', 1000)],
    [`owner:${ownerId}`, limit(isAnonymous ? 'AI_GUEST_DAILY_LIMIT' : 'AI_USER_DAILY_LIMIT', 200)],
  ]);
  for (const [scopeKey, max] of limits) {
    await db.query(`insert into app_private.ai_usage_days(day,scope_key,call_count) values($1,$2,0) on conflict do nothing`, [day, scopeKey]);
    const row = await db.query<{ call_count: number }>(`select call_count from app_private.ai_usage_days
      where day=$1 and scope_key=$2 for update`, [day, scopeKey]);
    if (!row.rows[0] || row.rows[0].call_count >= max) throw new AiOperationError('QUOTA', 'Daily AI call limit reached.');
    await db.query(`update app_private.ai_usage_days set call_count=call_count+1 where day=$1 and scope_key=$2`, [day, scopeKey]);
  }
}

export function createPgAiStore(databaseUrl = process.env.DATABASE_URL?.trim()) {
  if (!databaseUrl) throw new AiOperationError('CONFIGURATION', 'DATABASE_URL is required for AI operation persistence.');
  const pool = sharedPool(databaseUrl);
  const store: AiStore = {
    async reserve({ ownerId, isAnonymous, requestId, inputHash }) {
      return transaction(pool, async db => {
        const inserted = await db.query<{ id: string }>(`insert into app_private.operation_requests
          (owner_id,operation_kind,request_id,input_hash,state,usage_metadata)
          values($1,$2,$3,$4,'pending','{"calls":1}'::jsonb)
          on conflict(owner_id,operation_kind,request_id) do nothing returning id`,
        [ownerId, kind, requestId, inputHash]);
        const row = await db.query<{ id: string; state: OperationRecord['state']; input_hash: string; result_id: string | null }>(`
          select id,state,input_hash,result_id from app_private.operation_requests
          where owner_id=$1 and operation_kind=$2 and request_id=$3 for update`, [ownerId, kind, requestId]);
        if (!row.rows[0]) throw new AiOperationError('PROVIDER_FAILURE', 'Operation reservation failed.');
        const operation = row.rows[0];
        if (operation.input_hash !== inputHash) throw new AiOperationError('IDEMPOTENCY_CONFLICT', 'Request ID was reused for different content.');
        if (inserted.rowCount) await reserveCall(db, ownerId, isAnonymous);
        let result: SmokeOutput | undefined;
        if (!inserted.rowCount && operation.state === 'completed' && operation.result_id) {
          const saved = await db.query<{ validated_payload: SmokeOutput }>(`select validated_payload from app_private.operation_results
            where id=$1 and operation_id=$2`, [operation.result_id, operation.id]);
          result = saved.rows[0]?.validated_payload;
        }
        return { created: Boolean(inserted.rowCount), record: { id: operation.id, state: operation.state,
          inputHash: operation.input_hash, result } };
      });
    },
    async reserveRepair(ownerId, isAnonymous, operationId) {
      await transaction(pool, async db => {
        const row = await db.query<{ state: string; calls: number }>(`select state,
          coalesce((usage_metadata->>'calls')::int,0) as calls from app_private.operation_requests
          where id=$1 and owner_id=$2 and operation_kind=$3 for update`, [operationId, ownerId, kind]);
        if (!row.rows[0] || row.rows[0].state !== 'pending' || row.rows[0].calls !== 1)
          throw new AiOperationError('IDEMPOTENCY_CONFLICT', 'Repair call was already reserved or operation is closed.');
        await reserveCall(db, ownerId, isAnonymous);
        await db.query(`update app_private.operation_requests set usage_metadata=jsonb_set(usage_metadata,'{calls}','2'::jsonb),
          updated_at=now() where id=$1`, [operationId]);
      });
    },
    async complete(operationId, output, usage) {
      await transaction(pool, async db => {
        const row = await db.query<{ state: string }>(`select state from app_private.operation_requests where id=$1 and operation_kind=$2 for update`, [operationId, kind]);
        if (row.rows[0]?.state !== 'pending') throw new AiOperationError('IDEMPOTENCY_CONFLICT', 'Operation is no longer pending.');
        const result = await db.query<{ id: string }>(`insert into app_private.operation_results(operation_id,validated_payload)
          values($1,$2) returning id`, [operationId, output]);
        if (!result.rows[0]) throw new AiOperationError('PROVIDER_FAILURE', 'Could not save validated result.');
        await db.query(`update app_private.operation_requests set state='completed',result_id=$2,
          usage_metadata=usage_metadata || $3::jsonb,updated_at=now() where id=$1`, [operationId, result.rows[0].id, JSON.stringify(usage)]);
      });
    },
    async fail(operationId, state, reason) {
      await pool.query(`update app_private.operation_requests set state=$2,
        usage_metadata=usage_metadata || jsonb_build_object('outcome',$3::text),updated_at=now()
        where id=$1 and operation_kind=$4 and state='pending'`, [operationId, state, reason, kind]);
    },
  };
  return { store, close: () => closePools() };
}
