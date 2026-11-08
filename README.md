# LearningCompanion

LearningCompanion is a desktop web app that helps computing students find a direction for self-directed technology learning, study a concept through a visual lesson, and check what they understood.

## Problem Statement

Students in computing courses can find explanations in documentation, courses, social media, and AI tools, but those explanations are often disconnected. A student who knows a few tools may still struggle to choose what to learn next, see how concepts relate, or tell whether they can apply a concept independently. LearningCompanion addresses that gap in direction, connection, and feedback during self-directed study on a laptop.

## Solution Overview

A student opens the app (no sign-in; progress is kept for this browser), chooses interests and an experience level, and explores a topic tree covering ten technology areas. They can pick an existing topic, enter a topic of their own, or request three suggestions within a branch. When they start a new suggested topic, the app finds suitable public references, saves relevant passages, and generates a cited lesson and a three-question check. Their lesson position, answers, learning status, and activity are saved under an anonymous visitor ID kept in the browser, so they can return later on the same browser.

The tree shows where a topic was added; a generated parent-child link is not a verified prerequisite. A new suggested topic needs usable fetched passages before its lesson can start.

## Key Features

- **Personal starting point:** No-login onboarding for interests and overall experience.
- **Topic discovery:** Explore ten broad technology areas, then discover more topics by following your interests or choosing suggestions based on your learning history.
- **Guided lessons:** Short steps with text, diagrams, worked examples, common mistakes, citations, saved position, and a text tutor that can highlight diagram elements.
- **Understanding checks:** Three multiple-choice questions, including application; feedback, optional hints, and practice retries. First answers and help use remain separate from retries.
- **Visible progress:** Learning status in the tree, an unfinished lesson to resume, recommendations, suggested revisits, and recent activity on Home.

## AI Integration

The Express server calls models through [apiyi](https://apiyi.com) (`API_KEY`); the browser never holds the key. `MODEL_NAME` (default `deepseek-v4-1-flash-260910`) proposes topics and generates structured lessons, diagrams, questions, and tutor replies, in JSON mode with the shape in the prompt; zod validates every reply, and a lesson that fails gets one repair call that names the failing fields. Source discovery for student-suggested topics uses Gemini's Google Search grounding through apiyi's Gemini-native endpoint (`SEARCH_MODEL_NAME`, default `gemini-3.5-flash-lite`, which must stay a Gemini model; about US$0.014 per search plus tokens) to propose candidate URLs; catalogue lessons use the curated starter passages and never search. The server fetches and checks those pages itself, retrieves saved passages, validates citations and output shape, then stores the accepted lesson and private assessment keys. Catalogue lessons are cached in Postgres and reused for later visitors, so each starter topic is generated once.

AI-generated assessment keys are labelled **AI-assessed** even when the lesson has sources. Multiple-choice grading and learning status are computed by the server from stored answers and evidence, not decided by the model. Suggestions, source discovery, lesson generation, and tutor replies require working provider access; failures are shown as unavailable or retry states rather than a fabricated lesson.

## External Tools & Datasets

| Service or tool | Use |
| --- | --- |
| apiyi (Gemini 3.5 Flash Lite, Google Search grounding) | Topic suggestions, candidate source discovery, lesson and question generation, and tutor replies. |
| Neon Postgres | Saved learning data per anonymous visitor, the shared lesson cache, and approved and discovered passage snapshots. |
| Upstash Redis | Per-IP rate limiting via the AI Lodge shared engine. |
| React, Vite, Tailwind CSS, Express, TypeScript, Zod, and PostgreSQL | Application UI, API, validation, and storage. |

## Installation & Setup

You need Node.js 24, npm 11, a Postgres database (a Neon branch works) and an OpenRouter API key.

1. Install the workspaces: `npm ci`
2. Copy `.env.example` to `.env` and set at least `DATABASE_URL` and `API_KEY`. The API creates its schema and the starter catalogue on start; there is no migration step.
3. Start the frontend and API together with `npm run dev`, then open `http://127.0.0.1:5173`. Vite forwards `/api` to the Express API on port 8080.

`npm run typecheck`, `npm test` and `npm run lint` run the local checks; the database tests use embedded PostgreSQL (PGlite).

## Deployment (AI Lodge)

| Part | Where | Settings |
| --- | --- | --- |
| API | Cloud Run service `ail-ay2627-s1-darryl-learning-companion` (asia-southeast3) | `.github/workflows/deploy.yml` builds the repo-root `Dockerfile` (shared then server) on push to `main`; env vars come from the `DOTENV` secret (`gh secret set DOTENV < .env`). Request timeout is 300 s because a new lesson can take minutes. URL: `https://ail-ay2627-s1-darryl-learning-companion-464725632804.asia-southeast3.run.app` |
| Frontend | Vercel project `ail-ay2627-s1-darryl-learning-companion`, root directory `client` | `client/vercel.json` installs from the repo root (the client imports `shared/`). Set `VITE_API_BASE` to the Cloud Run URL. URL: `https://ail-ay2627-s1-darryl-learning-companion.vercel.app` |
| Database | Neon Postgres | `DATABASE_URL` with `?sslmode=require`; schema, seed and starter sources are applied automatically and idempotently at startup |

The API is rate limited per IP with the AI Lodge shared engine (buckets `gen`, `tutor`, `suggest`; `RATE_LIMIT_*` env fallbacks, default 5 per 5 days). Cached lessons and already-prepared topics do not count. The browser shows the AI Lodge CTA on HTTP 429 and a "demo paused" notice on 503.

## AI Safety & Limitations

- **Accuracy:** A valid schema and a real citation do not prove that an explanation, diagram, or answer key is correct. Generated questions have AI-assessed provenance; students should consult the linked source and treat the result as learning feedback, not a certified measure of mastery.
- **Source quality:** New lessons require retrieved passages that cover the selected objective. Candidate URLs come from grounding metadata, then the server checks public HTTPS access, redirects, robots rules, readable text, and coverage. Automated checks do not amount to human approval or a legal reuse determination. Some sites refuse requests from cloud hosting IPs; such pages are skipped, the search is retried once with them excluded, and if suitable sources still cannot be prepared, lesson creation fails visibly with a retry option.
- **RAG and chunking:** The app extracts readable text from checked source pages and splits it into smaller, heading-based passages called chunks. For a lesson, it retrieves a bounded selection of relevant saved chunks, gives those chunks to the model as context, and checks that the lesson cites chunks it actually received. This limits the material used for generation and makes claims traceable, but it cannot guarantee that a source is correct, that retrieval found the best passage, or that the AI interpreted it correctly.
- **Data and access:** There is no account: every API query is filtered by the browser's anonymous visitor ID, so one visitor cannot read another's tree, lessons, answers, or tutor messages. Anyone with that ID (it lives in the browser's localStorage) can continue that progress. Public assessment responses omit answer keys and private rubrics. Student text and fetched pages are treated as data in AI prompts; only the server updates learning status. Keep API keys and database credentials server-side.
- **Bounded operations:** Generation has schema and citation validation, request idempotency, timeouts, usage limits, and bounded retries. A saved lesson is reused rather than regenerated. A provider refusal, timeout, quota failure, or invalid output can still leave a topic without a lesson.

The current app uses multiple-choice checks. It does not include a separate recall-first review round, explanation or visual grading tasks, or an animated mascot.
