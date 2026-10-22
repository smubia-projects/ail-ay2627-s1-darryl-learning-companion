import { z } from 'zod';
import { type CompleteOnboarding, type HomeData, type Profile, type Recommendations, homeSchema, profileSchema } from '@learning-companion/shared';
import { sharedPool } from './db.js';
import { ApiError } from './errors.js';

export type ProfileService = {
  getProfile: (visitorId: string) => Promise<Profile>;
  completeOnboarding?: (visitorId: string, input: CompleteOnboarding) => Promise<Profile>;
  getHome?: (visitorId: string) => Promise<HomeData>;
};

const dayMs = 24 * 60 * 60 * 1000;
const relatedAreas: Partial<Record<Profile['interests'][number], string[]>> = {
  web_communication: ['web_communication'], apis: ['apis'], databases: ['databases'],
  web_development: ['apis'],
};

export function recommend(concepts: HomeData['concepts'], profile: Profile,
  progressRows: { concept_id: string; learning_status: string; latest_completed_round_id: string | null;
    last_reviewed_at: string | null; updated_at: string }[],
  edges: { from_concept_id: string; to_concept_id: string }[], successStreaks: Map<string, number>): Recommendations {
  const progress = new Map(progressRows.map(row => [row.concept_id, row]));
  const status = (conceptId: string) => progress.get(conceptId)?.learning_status ?? 'not_assessed';
  const availableNew = concepts.filter(concept => concept.contentAvailable && concept.status === 'not_assessed');
  const preferred = profile.interests.map(interest => availableNew.find(concept =>
    (relatedAreas[interest] ?? []).includes(concept.area))).find(Boolean);
  const missingPrerequisite = preferred && availableNew.find(concept => edges.some(edge =>
    edge.from_concept_id === concept.id && edge.to_concept_id === preferred.id && status(concept.id) !== 'demonstrated_understanding'));
  const learnConcept = missingPrerequisite ?? preferred ?? null;
  const learn: Recommendations['learn'] = !learnConcept ? null : missingPrerequisite ? {
    conceptId: learnConcept.id, reasonCode: 'prerequisite',
    reason: `Start here first; it prepares you for ${preferred?.title}. You can still choose another topic.`,
  } : {
    conceptId: learnConcept.id, reasonCode: 'interest',
    reason: 'This available lesson connects with the interests you selected. You can still choose another topic.',
  };

  const now = Date.now();
  const rankedReview: (Recommendations['review'][number] & { priority: number })[] = [];
  for (const concept of concepts) {
    const row = progress.get(concept.id);
    if (!row) continue;
    if (row.learning_status === 'developing' && !row.latest_completed_round_id) {
      rankedReview.push({ conceptId: concept.id, reasonCode: 'finish_check',
        reason: 'Complete the check so the app can confirm what you need to practise.', dueAt: null, priority: 0 });
    } else if (row.learning_status === 'developing') {
      const dueAt = new Date(new Date(row.updated_at).getTime() + dayMs).toISOString();
      rankedReview.push({ conceptId: concept.id, reasonCode: 'developing',
        reason: 'Your completed check showed gaps, so this is your highest-priority review.', dueAt, priority: 1 });
    } else if (row.learning_status === 'explored') {
      rankedReview.push({ conceptId: concept.id, reasonCode: 'explored',
        reason: 'You explored this lesson but have not completed its understanding check.', dueAt: null, priority: 2 });
    } else if (row.learning_status === 'demonstrated_understanding') {
      const successStreak = successStreaks.get(concept.id) ?? 1;
      const intervalDays = successStreak <= 1 ? 1 : successStreak === 2 ? 3 : 7;
      const dueAt = new Date(new Date(row.last_reviewed_at ?? row.updated_at).getTime() + intervalDays * dayMs).toISOString();
      if (new Date(dueAt).getTime() <= now) rankedReview.push({ conceptId: concept.id, reasonCode: 'recall_due',
        reason: `Your ${intervalDays}-day recall review is due.`, dueAt, priority: 3 });
    }
  }
  rankedReview.sort((a, b) => a.priority - b.priority);
  return { learn, review: rankedReview.map(({ priority: _priority, ...item }) => item) };
}

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const visitorIdSchema = z.uuid();

/**
 * Anonymous visitors replace Supabase Auth. The browser generates a random UUID once,
 * keeps it in localStorage and sends it as the bearer token; the first request creates
 * the visitor's profile row. Every learner-owned query filters by this owner ID.
 */
export function createProfileService(databaseUrl = process.env.DATABASE_URL?.trim()): ProfileService {
  if (!databaseUrl) {
    return { getProfile: async () => { throw new ApiError(500, 'SERVICE_UNAVAILABLE', 'The database is not configured.'); } };
  }
  const pool = sharedPool(databaseUrl);
  async function getProfile(visitorId: string): Promise<Profile> {
    if (!visitorIdSchema.safeParse(visitorId).success)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Reload the page to start a new learning session.');
    await pool.query('insert into public.profiles(user_id) values($1) on conflict (user_id) do nothing', [visitorId]);
    const profile = (await pool.query<{ user_id: string; interests: string[]; experience_level: string; onboarding_complete: boolean;
      timezone: string; reduced_motion: boolean; created_at: Date }>(`select user_id,interests,experience_level,onboarding_complete,
      timezone,reduced_motion,created_at from public.profiles where user_id=$1`, [visitorId])).rows[0];
    if (!profile) throw new ApiError(500, 'SERVICE_UNAVAILABLE', 'Your profile is temporarily unavailable.');
    return profileSchema.parse({
      userId: profile.user_id, isAnonymous: true,
      interests: profile.interests, experienceLevel: profile.experience_level,
      onboardingComplete: profile.onboarding_complete, timezone: profile.timezone,
      reducedMotion: profile.reduced_motion, createdAt: iso(profile.created_at),
    });
  }
  return {
    getProfile,
    async completeOnboarding(visitorId, input) {
      const profile = await getProfile(visitorId);
      await pool.query(`update public.profiles set interests=$2, experience_level=$3, timezone=$4,
        diagnostic_evidence=$5, onboarding_complete=true, updated_at=now() where user_id=$1`,
      [profile.userId, input.interests, input.experienceLevel, input.timezone, JSON.stringify(input.answers)]);
      return getProfile(visitorId);
    },
    async getHome(visitorId) {
      const profile = await getProfile(visitorId);
      const owner = profile.userId;
      const [catalogue, progress, sessions, availability, prerequisites, rounds] = await Promise.all([
        pool.query<{ id: string; slug: string; title: string; area: string; objectives: { description: string }[]; catalogue_order: number }>(
          `select id,slug,title,area,objectives,catalogue_order from public.concepts
          where supported and owner_id is null order by catalogue_order`),
        pool.query<{ concept_id: string; learning_status: string; latest_completed_round_id: string | null;
          last_reviewed_at: Date | null; updated_at: Date }>(`select concept_id,learning_status,latest_completed_round_id,
          last_reviewed_at,updated_at from public.user_concept_progress where owner_id=$1`, [owner]),
        pool.query<{ id: string; concept_id: string; created_at: Date; completed_at: Date | null }>(`select id,concept_id,
          created_at,completed_at from public.lesson_sessions where owner_id=$1 and generation_state='ready'
          and lesson->>'runningExample' is not null order by created_at desc limit 2000`, [owner]),
        pool.query<{ id: string }>('select id from public.available_lesson_concepts() as id'),
        pool.query<{ from_concept_id: string; to_concept_id: string }>(`select from_concept_id,to_concept_id
          from public.concept_edges where relation_type='prerequisite' and reviewed and owner_id is null`),
        pool.query<{ session_id: string; qualifies: boolean | null; completed_at: Date }>(`select session_id,qualifies,completed_at
          from public.assessment_rounds where owner_id=$1 and completed_at is not null
          order by completed_at desc limit 2000`, [owner]),
      ]);
      const conceptIds = catalogue.rows.map(row => row.id);
      const sourceLinks = conceptIds.length ? (await pool.query<{ title: string; canonical_url: string; concept_id: string }>(`
        select s.title,s.canonical_url,sc.concept_id from public.sources s
        join public.source_concepts sc on sc.source_id=s.id
        where sc.concept_id=any($1::uuid[]) and s.status='approved' and s.permission_review='allowed'
          and s.active_revision_id is not null order by s.canonical_url`, [conceptIds])).rows : [];
      const citationsByConcept = new Map<string, { title: string; url: string }[]>();
      for (const row of sourceLinks) {
        const links = citationsByConcept.get(row.concept_id) ?? [];
        links.push({ title: row.title, url: row.canonical_url });
        citationsByConcept.set(row.concept_id, links);
      }
      const ready = new Set(availability.rows.map(row => row.id));
      const generationReady = Boolean((process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim());
      const progressRows = progress.rows.map(row => ({ ...row,
        last_reviewed_at: row.last_reviewed_at ? iso(row.last_reviewed_at) : null, updated_at: iso(row.updated_at) }));
      const sessionRows = sessions.rows.map(row => ({ ...row, created_at: iso(row.created_at) }));
      const statuses = new Map(progressRows.map(row => [row.concept_id, row.learning_status]));
      const latestByConcept = new Map<string, { id: string; completed: boolean }>();
      for (const row of sessionRows) {
        if (!latestByConcept.has(row.concept_id)) latestByConcept.set(row.concept_id, { id: row.id, completed: Boolean(row.completed_at) });
      }
      const concepts: HomeData['concepts'] = catalogue.rows.map(row => ({
        id: row.id, slug: row.slug, title: row.title,
        description: row.objectives[0]?.description ?? null,
        objectives: row.objectives.map(objective => objective.description),
        citations: citationsByConcept.get(row.id) ?? [],
        area: row.area as HomeData['concepts'][number]['area'], order: row.catalogue_order,
        contentAvailable: generationReady && ready.has(row.id),
        sessionId: latestByConcept.get(row.id)?.id ?? null,
        sessionCompleted: latestByConcept.get(row.id)?.completed ?? false,
        status: (statuses.get(row.id) ?? 'not_assessed') as HomeData['concepts'][number]['status'],
      }));
      const sessionConcepts = new Map(sessionRows.map(row => [row.id, row.concept_id]));
      const successStreaks = new Map<string, number>();
      const endedStreaks = new Set<string>();
      for (const round of rounds.rows) {
        const conceptId = sessionConcepts.get(round.session_id);
        if (!conceptId || endedStreaks.has(conceptId)) continue;
        if (round.qualifies === true) successStreaks.set(conceptId, (successStreaks.get(conceptId) ?? 0) + 1);
        else endedStreaks.add(conceptId);
      }
      const recommendations = recommend(concepts, profile, progressRows, prerequisites.rows, successStreaks);
      const activityByDate = new Map<string, number>();
      const activityStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      for (const row of sessionRows) {
        if (row.created_at < activityStart) continue;
        const date = row.created_at.slice(0, 10);
        activityByDate.set(date, (activityByDate.get(date) ?? 0) + 1);
      }
      const activityCounts = [...activityByDate].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
      const latest = sessionRows[0];
      const unfinished = sessionRows.find(row => !row.completed_at);
      return homeSchema.parse({
        concepts, recommendations, activityCounts,
        recentSession: latest ? { id: latest.id, conceptId: latest.concept_id,
          createdAt: latest.created_at, completed: Boolean(latest.completed_at) } : null,
        unfinishedSession: unfinished ? { id: unfinished.id, conceptId: unfinished.concept_id } : null,
      });
    },
  };
}
