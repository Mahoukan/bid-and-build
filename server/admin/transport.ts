import express, { type Express } from 'express';
import { z } from 'zod';
import { deleteTemplateSchema, duplicateTemplateSchema, publicationSchema, templateIdSchema } from '../../shared/admin.js';
import { RoomFailure, type RoomService } from '../rooms/service.js';
import { AdminAuth } from './auth.js';
import { TemplateService } from './templates.js';
import type { PendingWork } from '../lifecycle.js';

export function registerAdministration(app: Express, auth: AdminAuth, templates: TemplateService, rooms: RoomService, work: PendingWork) {
  app.use(['/api/admin', '/api/templates'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.authorization?.startsWith('Display ')) throw new RoomFailure('DISPLAY_READ_ONLY', 'The shared display cannot make changes.', 403);
      auth.origin(req);
      if (!req.is('application/json')) throw new RoomFailure('JSON_REQUIRED', 'Send a JSON request.', 415);
    }
    auth.limit(`templates:${req.method === 'GET' ? 'read' : 'write'}:${req.ip}`, req.method === 'GET' ? 3000 : 100, 60_000);
    next();
  });
  app.post('/api/admin/login', (req, _res, next) => { auth.limit(`login:ip:${req.ip}`, 20, 15 * 60_000); next(); }, express.json({ limit: '2kb' }), async (req, res) => { res.json(await work.run(() => auth.login(req, res))); });
  app.get('/api/admin/session', (req, res) => { const status = auth.status(req); if (!status.authenticated) auth.cookie(res, null); res.json(status); });
  app.post('/api/admin/logout', (req, res) => { auth.logout(req, res); res.json({ ok: true }); });
  app.use('/api/admin/templates', (req, _res, next) => { auth.require(req, !['GET', 'HEAD'].includes(req.method)); next(); }, express.json({ limit: '12mb' }));
  app.param('templateId', (req, _res, next, value: string) => { if (!templateIdSchema.safeParse(value).success) throw new RoomFailure('TEMPLATE_NOT_FOUND', 'Template not found.', 404); req.params.templateId = value; next(); });
  app.get('/api/admin/templates', (_req, res) => res.json({ templates: templates.list() }));
  app.post('/api/admin/templates', async (req, res) => { res.status(201).json(await work.run(() => templates.save(req.body, () => { auth.require(req, true); }))); });
  app.get('/api/admin/templates/:templateId', (req, res) => res.json(templates.get(req.params.templateId as string)));
  app.put('/api/admin/templates/:templateId', async (req, res) => { res.json(await work.run(() => templates.save(req.body, () => { auth.require(req, true); }, req.params.templateId as string))); });
  app.post('/api/admin/templates/:templateId/duplicate', async (req, res) => {
    const parsed = duplicateTemplateSchema.safeParse(req.body); if (!parsed.success) throw new RoomFailure('INVALID_REQUEST', 'Provide the current template revision.');
    res.status(201).json(await work.run(() => templates.duplicate(req.params.templateId as string, parsed.data.revision, () => { auth.require(req, true); })));
  });
  app.post('/api/admin/templates/:templateId/publication', (req, res) => {
    const parsed = publicationSchema.safeParse(req.body); if (!parsed.success) throw new RoomFailure('INVALID_REQUEST', 'Provide a publication choice and current revision.');
    res.json(templates.publish(req.params.templateId as string, parsed.data.revision, parsed.data.published));
  });
  app.delete('/api/admin/templates/:templateId', (req, res) => {
    const parsed = deleteTemplateSchema.safeParse(req.body); if (!parsed.success) throw new RoomFailure('CONFIRM_REQUIRED', 'Confirm deletion with the current revision.');
    templates.delete(req.params.templateId as string, parsed.data.revision); res.json({ ok: true });
  });
  app.get('/api/templates', (req, res) => {
    const parsed = z.strictObject({ page: z.string().regex(/^\d{1,4}$/).transform(Number).optional() }).safeParse(req.query);
    if (!parsed.success) throw new RoomFailure('INVALID_PAGE', 'Choose a valid catalogue page.'); res.json(templates.catalogue(parsed.data.page ?? 0));
  });
  app.get('/api/templates/:templateId/cover', (req, res) => { res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); res.type('image/png').send(templates.cover(req.params.templateId as string)); });
  app.post('/api/templates/:templateId/host', (req, _res, next) => { auth.limit(`catalogue-host:${req.ip}`, 10, 60_000); next(); }, express.json({ limit: '8kb' }), async (req, res) => {
    const id = req.params.templateId as string;
    res.status(201).json(await rooms.createFromCatalogue(id, req.body, () => templates.get(id, true).template));
  });
}
