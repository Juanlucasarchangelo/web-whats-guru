
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { sendTextToWhatsApp } from '../services/whatsapp.js';
import { publicLocation } from '../services/evolution-media.js';

import {
  loadEvolution,
  sendEvolutionText,
  syncEvolutionConversation,
  fetchEvolutionMedia,
} from '../services/evolution.js';

import {
  visibleChannelIds,
  conversationScope,
  requireConversation,
} from '../services/channel-access.js';

import {
  getOrCreateConversation,
  withConversationIdentityLock,
} from '../services/conversation-thread.js';

import { saveMedia, readMedia } from '../services/nas-storage.js';

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

function mediaFilename(message, mime) {
  const original = path.basename(
    String(message.media_name || '').replace(/\\/g, '/')
  );

  if (original && original !== '.' && original !== '..') {
    return original;
  }

  return `${message.id}${mediaExtensions[mime] || '.bin'}`;
}

/**
 * Arquiva uma mídia no QNAP.
 *
 * Estrutura:
 *
 * Public/
 *   Falacomigo/
 *     Nome da conexão/
 *       Telefone - Nome do contato/
 *         arquivo.ext
 */
async function archiveEvolutionMedia({
  orgId,
  conversation,
  message,
  mime,
  bytes,
}) {
  if (!process.env.FALACOMIGO_STORAGE_PATH) {
    return;
  }

  const api = await loadEvolution(
    orgId,
    conversation.integration_id
  );

  if (!api) {
    throw new Error('Integração Evolution indisponível.');
  }

  // Nome definido no painel Integrações do FalaComigo.
  const connectionName = String(
    api.integration?.name || api.instance
  ).trim();

  // Busca telefone e nome do contato.
  const contact = await prisma.contact.findFirst({
    where: {
      id: conversation.contact_id,
      org_id: orgId,
    },
    select: {
      phone: true,
      name: true,
    },
  });

  const phone = String(
    contact?.phone || ''
  ).replace(/\D/g, '');

  const contactName = String(
    contact?.name || ''
  ).trim();

  const contactIdentifier = phone || conversation.contact_id;

  const contactFolder = contactName
    ? `${contactIdentifier} - ${contactName}`
    : contactIdentifier;

  // O nas-storage.js sanitiza os nomes das pastas.
  const saved = await saveMedia({
    instance: connectionName,
    contact: contactFolder,
    filename: mediaFilename(message, mime),
    buffer: bytes,
  });

  // Preserva os metadados originais da Evolution API.
  const metadata = {
    ...message.media_message,
    nas_path: saved.relativePath,
  };

  // Registra o caminho relativo no MySQL.
  await prisma.message.update({
    where: {
      id: message.id,
    },
    data: {
      media_message: metadata,
    },
  });

  console.info('[NAS] Mídia arquivada com sucesso:', {
    messageId: message.id,
    connection: connectionName,
    contact: contactFolder,
    path: saved.relativePath,
    size: saved.size,
  });
}

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

  // Lista as conversas autorizadas.
  router.get('/', wrap(async (req, res) => {
    const limit = Math.min(
      Math.max(
        Number.parseInt(String(req.query.limit || 30), 10) || 30,
        1
      ),
      100
    );

    const where = await conversationScope(req);

    const data = await prisma.conversation.findMany({
      where,
      take: limit,
      orderBy: {
        last_message_at: 'desc',
      },
    });

    const contacts = data.length
      ? await prisma.contact.findMany({
        where: {
          org_id: req.orgId,
          id: {
            in: data.map(c => c.contact_id),
          },
        },
        select: {
          id: true,
          name: true,
          phone: true,
        },
      })
      : [];

    const lookup = new Map(
      contacts.map(contact => [contact.id, contact])
    );

    res.json({
      data: data.map(c => ({
        ...c,
        contact: lookup.get(c.contact_id) || null,
      })),
    });
  }));

  // Cria uma conversa.
  router.post('/', wrap(async (req, res) => {
    const input = newConversation.parse(req.body);

    const contact = await prisma.contact.findFirst({
      where: {
        id: input.contact_id,
        org_id: req.orgId,
      },
      select: {
        id: true,
        phone: true,
      },
    });

    if (!contact) {
      throw new HttpError(
        404,
        'Contato nao encontrado nesta organizacao.'
      );
    }

    let integrationId = null;

    if (input.channel === 'whatsapp') {
      const channels = await visibleChannelIds(req);

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

  // Lista as mensagens de uma conversa.
  router.get('/:id/messages', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);

    const conversation = await requireConversation(req, id);

    if (!conversation) {
      throw new HttpError(404, 'Conversa nao encontrada.');
    }

    const data = await prisma.message.findMany({
      where: {
        conversation_id: id,
        org_id: req.orgId,
      },
      take: 100,
      orderBy: {
        created_at: 'desc',
      },
    });

    res.json({
      data: data.reverse().map(({ media_message, ...row }) => ({
        ...row,
        media_location: row.media_type === 'location'
          ? publicLocation(media_message)
          : null,
      })),
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
      res.set(
        'Content-Disposition',
        `inline; filename="${msg.id}"`
      );
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');

      res.send(bytes);
    })
  );

  // Sincroniza mensagens com a Evolution API.
  router.post(
    '/:id/sync-evolution',
    wrap(async (req, res) => {
      const id = idParam.parse(req.params.id);

      const conversation = await requireConversation(req, id);

      if (!conversation) {
        throw new HttpError(404, 'Conversa nao encontrada.');
      }

      if (conversation.channel !== 'whatsapp') {
        throw new HttpError(
          400,
          'Sincronizacao Evolution disponivel apenas para WhatsApp.'
        );
      }

      const result = await syncEvolutionConversation({
        orgId: req.orgId,
        conversation,
      });

      res.json({
        ok: true,
        ...result,
      });
    })
  );

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
