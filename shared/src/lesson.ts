import { z } from 'zod';
import { contentIdSchema, entityIdSchema, proseSchema, shortTextSchema, uniqueIds } from './common.js';
import { sourceModeSchema } from './constants.js';

export const diagramIconSchema = z.enum(['client', 'server', 'api', 'database', 'table', 'json', 'security', 'mobile', 'web', 'exchange', 'generic']);
const nodeSchema = z.strictObject({ id: contentIdSchema, label: shortTextSchema.max(50), description: proseSchema,
  example: shortTextSchema.max(200), icon: diagramIconSchema.optional() });
const edgeSchema = z.strictObject({ id: contentIdSchema, from: contentIdSchema, to: contentIdSchema, label: shortTextSchema.max(60) });
const diagramFields = {
  id: contentIdSchema, title: shortTextSchema,
  nodes: z.array(nodeSchema).max(8), edges: z.array(edgeSchema).max(24),
};
const tableSchema = z.strictObject({
  columns: z.array(shortTextSchema).min(1).max(8),
  rows: z.array(z.array(shortTextSchema).min(1).max(8)).min(1).max(20),
});
export const diagramSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...diagramFields, type: z.literal('flow'), nodes: diagramFields.nodes.min(2), edges: diagramFields.edges.min(1) }),
  z.strictObject({ ...diagramFields, type: z.literal('relationship'), nodes: diagramFields.nodes.min(2), edges: diagramFields.edges.min(1) }),
  z.strictObject({ ...diagramFields, type: z.literal('table'), table: tableSchema }),
]).superRefine((diagram, ctx) => {
  if (!uniqueIds([...diagram.nodes.map(n => n.id), ...diagram.edges.map(e => e.id)])) {
    ctx.addIssue({ code: 'custom', message: 'Diagram part IDs must be unique.' });
  }
  const nodes = new Set(diagram.nodes.map(n => n.id));
  diagram.edges.forEach((edge, index) => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to) {
      ctx.addIssue({ code: 'custom', path: ['edges', index], message: 'Edge endpoints must reference this diagram.' });
    }
  });
  if (diagram.type !== 'table' && diagram.nodes.some(node => !diagram.edges.some(edge => edge.from === node.id || edge.to === node.id))) {
    ctx.addIssue({ code: 'custom', message: 'Every example part needs a connection.' });
  }
  if (diagram.type === 'table') {
    if (diagram.nodes.length || diagram.edges.length) ctx.addIssue({ code: 'custom', message: 'Tables use rows instead of nodes and edges.' });
    diagram.table.rows.forEach((row, index) => {
      if (row.length !== diagram.table.columns.length) {
        ctx.addIssue({ code: 'custom', path: ['table', 'rows', index], message: 'Table rows must be rectangular.' });
      }
    });
  }
});
export const lessonStepSchema = z.strictObject({
  id: contentIdSchema, heading: shortTextSchema,
  caption: proseSchema.refine(text => text.split(/\s+/u).length <= 100, 'Captions must contain at most 100 words.'),
  explanation: proseSchema.min(40).max(2400),
  workedExample: proseSchema.min(30).max(1200),
  commonMistake: proseSchema.min(20).max(800),
  diagramId: contentIdSchema,
  highlightNodeIds: z.array(contentIdSchema).max(8).refine(uniqueIds),
  highlightEdgeIds: z.array(contentIdSchema).max(24).refine(uniqueIds),
  highlightRowIndexes: z.array(z.number().int().min(0)).max(20).refine(values => new Set(values).size === values.length),
  citationChunkIds: z.array(entityIdSchema).max(6).refine(uniqueIds),
});
export const lessonSchema = z.strictObject({
  id: entityIdSchema, conceptId: entityIdSchema, title: shortTextSchema,
  runningExample: proseSchema.min(10).max(300),
  sourceMode: sourceModeSchema, contentVersion: shortTextSchema,
  objectives: z.array(z.strictObject({ id: contentIdSchema, description: shortTextSchema })).min(1).max(12),
  citationChunkIds: z.array(entityIdSchema).max(6).refine(uniqueIds),
  diagrams: z.array(diagramSchema).min(1).max(2),
  steps: z.array(lessonStepSchema).min(4).max(6),
}).superRefine((lesson, ctx) => {
  for (const field of ['objectives', 'diagrams', 'steps'] as const) {
    if (!uniqueIds(lesson[field].map(item => item.id))) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} IDs must be unique.` });
    }
  }
  const citations = new Set(lesson.citationChunkIds);
  if (lesson.sourceMode === 'source_grounded' && citations.size === 0) {
    ctx.addIssue({ code: 'custom', path: ['citationChunkIds'], message: 'Source-grounded lessons need supporting chunks.' });
  }
  lesson.steps.forEach((step, index) => {
    const diagram = lesson.diagrams.find(item => item.id === step.diagramId);
    if (!diagram) {
      ctx.addIssue({ code: 'custom', path: ['steps', index, 'diagramId'], message: 'Unknown diagram.' });
    }
    if (step.highlightNodeIds.some(id => !diagram?.nodes.some(node => node.id === id)) ||
        step.highlightEdgeIds.some(id => !diagram?.edges.some(edge => edge.id === id)) ||
        step.highlightRowIndexes.some(row => diagram?.type !== 'table' || row >= diagram.table.rows.length) ||
        (diagram?.type === 'table' ? !step.highlightRowIndexes.length : !step.highlightNodeIds.length && !step.highlightEdgeIds.length)) {
      ctx.addIssue({ code: 'custom', path: ['steps', index], message: 'Highlights must reference parts of the step diagram.' });
    }
    if (step.citationChunkIds.some(id => !citations.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['steps', index, 'citationChunkIds'], message: 'Unknown citation chunk.' });
    }
    if (lesson.sourceMode === 'source_grounded' && step.citationChunkIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['steps', index, 'citationChunkIds'], message: 'Source-grounded steps need citations.' });
    }
  });
});
// Matching stored chunk IDs against retrieved/approved chunks remains a server responsibility.
export type DiagramSpec = z.infer<typeof diagramSchema>;
export type LessonStep = z.infer<typeof lessonStepSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
