import { z } from 'zod';
import { templateSchema } from './template.js';

export const adminNameSchema = z.string().trim().toLowerCase().min(3).max(64).regex(/^[a-z0-9][a-z0-9._-]+$/);
export const passwordSchema = z.string().min(15, 'Use at least 15 characters.').max(128, 'Use at most 128 characters.');
export const loginSchema = z.strictObject({ username: adminNameSchema, password: passwordSchema });
export const templateIdSchema = z.uuid();
export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
export const saveTemplateSchema = z.strictObject({ template: templateSchema, revision: revisionSchema.optional() });
export const publicationSchema = z.strictObject({ published: z.boolean(), revision: revisionSchema });
export const deleteTemplateSchema = z.strictObject({ confirmed: z.literal(true), revision: revisionSchema });
export const duplicateTemplateSchema = z.strictObject({ revision: revisionSchema });
export type AdminSession = { authenticated: false } | { authenticated: true; username: string; csrfToken: string; expiresAt: number };
export type TemplateSummary = { id: string; title: string; description: string; optionCount: number; coverUrl: string | null; revision: number; published: boolean; updatedAt: number };
export type AdminTemplate = { id: string; revision: number; published: boolean; template: z.infer<typeof templateSchema> };
// Public previews intentionally contain no option IDs, text, images or order.
export type CatalogueTemplate = Pick<TemplateSummary, 'id' | 'title' | 'description' | 'optionCount' | 'coverUrl'>;
