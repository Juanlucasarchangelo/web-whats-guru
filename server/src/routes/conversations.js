
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { sendTextToWhatsApp } from '../services/whatsapp.js';
import { queueEvolutionHistory, getEvolutionHistoryStatus } from '../services/evolution-sync.js';
import { publicLocation } from '../services/evolution-media.js';

import {
  loadEvolution,
  sendEvolutionText,
  fetchEvolutionMedia,
} from '../services/evolution.js';

import {
  visibleChannelIds,
  inboxChannelIds,
  conversationScope,
  requireConversation,
  admin,
} from '../services/channel-access.js';

import {
  getOrCreateConversation,
  withConversationIdentityLock,
} from '../services/conversation-thread.js';

import { readMedia, safeMediaFilename } from '../services/nas-storage.js';
import { archiveEvolutionMedia, originalMediaFilename } from '../services/evolution-media-archive.js';

const idParam = z.string().uuid();

const newConversation = z.object({
  contact_id: z.string().uuid(),
  channel: z.enum([
    'whatsapp',
    'instagram',
    'email',
    'webchat',
  ]).default('whatsapp'),
  subject: z.string().trim().max(300).nullable().optional(),
  integration_id: z.string().uuid().optional(),
}).strict();

const newMessage = z.object({
  body: z.string().trim().min(1).max(10000),
  is_internal: z.boolean().optional(),
}).strict();

const editConversation = z.object({
  status: z.enum([
    'open',
    'pending',
    'resolved',
    'closed',
  ]),
}).strict();

const allowedMedia = {
  image: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ],
  sticker: [
    'image/webp',
    'image/png',
  ],
  audio: [
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/wav',
    'audio/webm',
  ],
  video: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ],
  document: [
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/octet-stream',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

const mediaExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

/**
 * Recupera uma mídia.
 *
 * Prioridade:
 * 1. QNAP
 * 2. Evolution API
 *
 * Se buscar na Evolution, tenta arquivar no QNAP.
 */
async function getConversationMedia({
  orgId,
  conversation,
  message,
  mime,
}) {
  const storedPath = message.media_message?.nas_path;

  // Primeiro tenta ler a mídia já armazenada no QNAP.
  if (storedPath) {
    try {
      const bytes = await readMedia(storedPath);

      console.info('[NAS] Mídia recuperada:', {
        messageId: message.id,
        path: storedPath,
      });

      return bytes;
    } catch (error) {
      console.warn('[NAS] Falha ao ler mídia arquivada:', {
        messageId: message.id,
        error: error.message,
      });
    }
  }

  // Caso não esteja disponível no NAS, busca na Evolution.
  const bytes = await fetchEvolutionMedia({
    orgId,
    integrationId: conversation.integration_id,
    mediaMessage: message.media_message,
  });

  // Falha no arquivamento não deve impedir a visualização.
  if (process.env.FALACOMIGO_STORAGE_PATH) {
    try {
      await archiveEvolutionMedia({
        orgId,
        conversation,
        message,
        mime,
        bytes,
      });
    } catch (error) {
      console.error('[NAS] Falha ao arquivar mídia:', {
        messageId: message.id,
        error: error.message,
      });
    }
  }

  return bytes;
}

export function conversationsRouter() {
  const router = Router();

  // Inbox: pagina no banco e devolve os contatos junto com as conversas.
  // Isso evita consultas IN com mais de 500 IDs que geravam "Desconhecido".
  router.get('/', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 100), 10) || 100, 1), 100);
    const page = Math.min(Math.max(Number.parseInt(String(req.query.page || 1), 10) || 1, 1), 100000);
    const where = await conversationScope(req);
    const status = String(req.query.status || 'all');
    const assignee = String(req.query.assignee || 'all');
    const search = String(req.query.search || '').trim().slice(0, 120);
    const channelId = req.query.integration_id ? idParam.parse(String(req.query.integration_id)) : null;
    const tagId = req.query.tag_id ? idParam.parse(String(req.query.tag_id)) : null;
    const kind = String(req.query.kind || 'all');
    if (!['all', 'private', 'groups'].includes(kind)) throw new HttpError(400, 'Filtro de conversas inválido.');
    if (kind !== 'all') where.is_group = kind === 'groups';
    if (status !== 'all') {
      if (!['open','pending','closed','resolved'].includes(status)) throw new HttpError(400,'Status invalido.');
      where.status = status;
    }
    if (assignee === 'me') where.assigned_to = req.user.id;
    else if (assignee === 'unassigned') where.assigned_to = null;
    else if (assignee !== 'all') throw new HttpError(400,'Filtro de atendente invalido.');
    if (channelId) {
      if (!(await inboxChannelIds(req)).includes(channelId)) throw new HttpError(404,'Instancia nao encontrada ou sem acesso.');
      where.integration_id = channelId;
    }
    if (tagId) where.conversation_tags = { some: { tag_id: tagId } };
    if (search) where.contacts = { OR: [
      { name: { contains: search } }, { phone: { contains: search } },
    ] };
    const [total, rows] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.findMany({ where, take: limit, skip: (page-1)*limit,
        orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
      }),
    ]);
    // Buscar os nomes no servidor, filtrando org_id e em lotes de ate 100.
    // Nunca expor contatos de outra empresa se houver referencia historica incorreta.
    const contacts = rows.length ? await prisma.contact.findMany({where:{
      org_id:req.orgId,id:{in:rows.map(row=>row.contact_id)},
    },select:{id:true,name:true,phone:true}}) : [];
    const names = new Map(contacts.map(contact=>[contact.id,contact]));
    const groups = rows.some(row => row.is_group) ? await prisma.whatsAppGroup.findMany({
      where: { org_id: req.orgId, conversation_id: { in: rows.filter(row => row.is_group).map(row => row.id) } },
      select: { id: true, conversation_id: true, subject: true, jid: true, participant_count: true },
    }) : [];
    const groupsByConversation = new Map(groups.map(group => [group.conversation_id, group]));
    const data = rows.map(row => ({ ...row,contact:names.get(row.contact_id)||null,
      group: groupsByConversation.get(row.id) || null }));
    res.json({ data, total, page, limit, has_more: page * limit < total });
  }));

  // Cria uma conversa.
  router.post('/', wrap(async (req, res) => {
    const input = newConversation.parse(req.body);

    const contact = await prisma.contact.findFirst({
      where: {
        id: input.contact_id,
        org_id: req.orgId, is_group: false,
      },
      select: {
        id: true,
        phone: true,
      },
    });

    if (!contact) {
      throw new HttpError(404, 'Contato nao encontrado nesta organizacao.');
    }
    if (await prisma.whatsAppGroup.count({ where: { org_id: req.orgId, contact_id: contact.id } }))
      throw new HttpError(400, 'Grupos devem ser abertos pela Caixa de Entrada.');

    let integrationId = null;

    if (input.channel === 'whatsapp') {
      const channels = await inboxChannelIds(req);

      integrationId = input.integration_id ??
        (channels.length === 1 ? channels[0] : null);

      if (!integrationId || !channels.includes(integrationId)) {
        throw new HttpError(
          400,
          'Selecione um numero de WhatsApp autorizado para iniciar a conversa.'
        );
      }
    }

    if (input.channel !== 'whatsapp') {
      const conversation = await prisma.conversation.create({
        data: {
          id: randomUUID(),
          org_id: req.orgId,
          contact_id: contact.id,
          channel: input.channel,
          subject: input.subject ?? null,
          assigned_to: admin(req) ? null : req.user.id,
          status: 'open',
        },
      });

      return res.status(201).json(conversation);
    }

    const { conversation, created } =
      await withConversationIdentityLock({
        orgId: req.orgId,
        integrationId,
        contactId: contact.id,
        phone: contact.phone,
        channel: input.channel,
      }, async () => {
        const result = await getOrCreateConversation(prisma, {
          orgId: req.orgId,
          contactId: contact.id,
          integrationId,
          channel: input.channel,
          subject: input.subject ?? null,
        });

        if (
          !result.created &&
          ['closed', 'resolved'].includes(
            result.conversation.status
          )
        ) {
          result.conversation = await prisma.conversation.update({
            where: {
              id: result.conversation.id,
            },
            data: {
              status: 'open',
            },
          });
        }

        return result;
      });

    if(created && !admin(req) && !conversation.assigned_to){
      const assigned=await prisma.conversation.update({where:{id:conversation.id},data:{assigned_to:req.user.id}});
      return res.status(201).json(assigned);
    }
    res.status(created ? 201 : 200).json(conversation);
  }));

  // Atualiza o status de uma conversa.
  router.patch('/:id', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = editConversation.parse(req.body);

    await requireConversation(req, id);

    const result = await prisma.conversation.updateMany({
      where: {
        id,
        org_id: req.orgId,
      },
      data: input,
    });

    if (!result.count) {
      throw new HttpError(404, 'Conversa nao encontrada.');
    }

    res.json(
      await prisma.conversation.findFirst({
        where: {
          id,
          org_id: req.orgId,
        },
      })
    );
  }));

  // Paginated message timeline. Older pages remain available indefinitely in MySQL.
  router.get('/:id/messages', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    await requireConversation(req, id);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 100), 10) || 100, 1), 200);
    const cursor = req.query.cursor ? idParam.parse(String(req.query.cursor)) : null;
    if (cursor) {
      const parent = await prisma.message.findFirst({ where: { id: cursor, conversation_id: id, org_id: req.orgId }, select: { id: true } });
      if (!parent) throw new HttpError(404, 'Marcador de paginacao invalido.');
    }
    const rows = await prisma.message.findMany({
      where: { conversation_id: id, org_id: req.orgId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    res.json({
      data: data.reverse().map(({ media_message, ...row }) => ({
        ...row, media_location: row.media_type === 'location' ? publicLocation(media_message) : null,
      })),
      next_cursor: hasMore ? data[data.length - 1].id : null,
    });
  }));

  // Mídias WhatsApp: QNAP primeiro, Evolution como alternativa.
  router.get(
    '/:id/messages/:messageId/media',
    wrap(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const messageId = idParam.parse(req.params.messageId);

      const conversation = await requireConversation(req, id);

      if (!conversation) {
        throw new HttpError(404, 'Conversa nao encontrada.');
      }

      const msg = await prisma.message.findFirst({
        where: {
          id: messageId,
          conversation_id: id,
          org_id: req.orgId,
        },
      });

      if (!msg?.media_type) {
        throw new HttpError(404, 'Mensagem sem midia.');
      }

      const mime = (msg.media_mime || '').toLowerCase();

      if (!allowedMedia[msg.media_type]?.includes(mime)) {
        throw new HttpError(
          415,
          'Formato de midia nao permitido para visualizacao.'
        );
      }

      const bytes = await getConversationMedia({
        orgId: req.orgId,
        conversation,
        message: msg,
        mime,
      });

      res.set('Content-Type', mime);
      const filename = safeMediaFilename(originalMediaFilename(msg));
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');

      res.send(bytes);
    })
  );

  // History is imported in a background job, never in the HTTP request itself.
  router.get('/:id/sync-evolution-status', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const conversation = await requireConversation(req, id);
    const channel = conversation.integration_id ? await prisma.integration.findFirst({
      where: { id: conversation.integration_id, org_id: req.orgId, type: 'whatsapp' },
      select: { config: true },
    }) : null;
    // Provider type is non-secret; never expose instance credentials or metadata.
    res.json({ sync: getEvolutionHistoryStatus(req.orgId, id),
      provider: channel?.config?.provider || null });
  }));
  router.post('/:id/sync-evolution', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const conversation = await requireConversation(req, id);
    if (conversation.channel !== 'whatsapp') throw new HttpError(400, 'Somente conversas WhatsApp podem sincronizar.');
    // DEV/Master/Administrador may READ historical messages from the entire
    // selected organization, but channel administration remains owner/Master only.
    if (!admin(req)) {
      const channelIds = await visibleChannelIds(req);
      if (!channelIds.includes(conversation.integration_id))
        throw new HttpError(403, 'Sem acesso as mensagens desta conversa.');
    }
    const force = req.body?.force === true;
    res.status(202).json({ ok: true, sync: queueEvolutionHistory({ orgId: req.orgId, conversation, force }) });
  }));

  // Envia uma mensagem.
  router.post('/:id/messages', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = newMessage.parse(req.body);

    const conversation = await requireConversation(req, id);

    if (!conversation) {
      throw new HttpError(404, 'Conversa nao encontrada.');
    }

    if (
      conversation.channel === 'whatsapp' &&
      !input.is_internal
    ) {
      const evolution = await loadEvolution(
        req.orgId,
        conversation.integration_id
      );

      if (evolution) {
        const message = await sendEvolutionText({
          orgId: req.orgId,
          conversation,
          text: input.body,
          userId: req.user.id,
        });

        return res.status(201).json({
          ...message,
          accepted_by_evolution: true,
          delivered_to_whatsapp: false,
        });
      }

      const target = await prisma.integration.findFirst({
        where: {
          id: conversation.integration_id ?? '',
          org_id: req.orgId,
          type: 'whatsapp',
        },
      });

      if (
        !target ||
        target.config?.connection_mode !== 'official'
      ) {
        throw new HttpError(
          409,
          'Conversa sem instancia Evolution ou API oficial valida. Selecione o numero correto.'
        );
      }

      const message = await sendTextToWhatsApp({
        orgId: req.orgId,
        conversation,
        text: input.body,
        userId: req.user.id,
      });

      return res.status(201).json({
        ...message,
        accepted_by_meta: true,
        delivered_to_whatsapp: false,
      });
    }

    const message = await prisma.$transaction(async tx => {
      const row = await tx.message.create({
        data: {
          id: randomUUID(),
          org_id: req.orgId,
          conversation_id: id,
          body: input.body,
          sender_type: 'agent',
          sender_id: req.user.id,
          channel: conversation.channel,
          status: 'local_only',
          is_internal: input.is_internal ?? false,
        },
      });

      await tx.conversation.update({
        where: {
          id,
        },
        data: {
          last_message_at: row.created_at,
        },
      });

      return row;
    });

    res.status(201).json({
      ...message,
      delivered_to_whatsapp: false,
    });
  }));

  return router;
}
