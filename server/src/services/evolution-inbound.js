
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';

import {
  digits,
  stableMessageId,
  inboundPhone,
  getEvolutionText,
  validTime,
} from './evolution-payload.js';

import { processIncomingWorkflows } from './workflow-engine.js';

import {
  identifyEvolutionMedia,
  mediaLabel,
} from './evolution-media.js';

import { loadEvolution } from './evolution.js';

import {
  getOrCreateConversation,
  withConversationIdentityLock,
} from './conversation-thread.js';

const ignored = reason => ({ outcome: reason });

function cleanName(value, phone) {
  const name = String(value ?? '').trim().slice(0, 150);

  if (!name) return null;

  if (
    name === phone ||
    name === `+${phone}` ||
    name === `WhatsApp ${phone}`
  ) {
    return null;
  }

  if (
    digits(name) === phone &&
    /^[+\d\s().-]+$/.test(name)
  ) {
    return null;
  }

  return name;
}

function firstName(values, phone) {
  for (const value of values) {
    const name = cleanName(value, phone);

    if (name) return name;
  }

  return null;
}

/**
 * Consulta o contato na Evolution API.
 *
 * Prioridade:
 * 1. Nome salvo na agenda sincronizada
 * 2. Nome público do WhatsApp
 * 3. Número, caso nenhum nome esteja disponível
 *
 * Importante:
 * A Evolution pode não disponibilizar o nome
 * da agenda em determinadas instalações.
 */
async function getWhatsAppContactName({
  orgId,
  integrationId,
  phone,
  item,
  envelope,
  fromMe,
}) {
  let savedName = null;
  let publicName = null;

  if (integrationId) {
    try {
      const api = await loadEvolution(
        orgId,
        integrationId
      );

      if (api?.url && api?.instance && api?.apiKey) {
        const endpoint =
          `${api.url.replace(/\/$/, '')}` +
          `/chat/findContacts/${encodeURIComponent(api.instance)}`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            apikey: api.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            where: {
              remoteJid: `${phone}@s.whatsapp.net`,
            },
          }),
          signal: AbortSignal.timeout(6000),
        });

        if (response.ok) {
          const payload = await response.json();

          const contacts = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.data)
              ? payload.data
              : Array.isArray(payload?.contacts)
                ? payload.contacts
                : payload && typeof payload === 'object'
                  ? [payload]
                  : [];

          const matchingContact = contacts.find(contact => {
            const remoteJid = String(
              contact?.remoteJid ||
              contact?.jid ||
              contact?.id ||
              ''
            );

            if (!remoteJid.endsWith('@s.whatsapp.net')) {
              return false;
            }

            return digits(remoteJid.split('@')[0]) === phone;
          });

          if (matchingContact) {
            // Campos que podem representar o nome
            // salvo na agenda sincronizada.
            savedName = firstName([
              matchingContact.name,
              matchingContact.fullName,
              matchingContact.contactName,
              matchingContact.savedName,
              matchingContact.firstName,
            ], phone);

            // Nome de perfil conhecido pela Evolution.
            publicName = firstName([
              matchingContact.pushName,
              matchingContact.notify,
              matchingContact.verifiedName,
            ], phone);
          }
        } else {
          console.warn('[Contacts] Consulta Evolution:', {
            status: response.status,
            integrationId,
          });
        }
      }
    } catch (error) {
      console.warn('[Contacts] Falha ao consultar contato:', {
        integrationId,
        error: error.message,
      });
    }
  }

  // O pushName de uma mensagem enviada por você
  // pode ser o seu próprio nome.
  // Por isso, só usamos o pushName da mensagem
  // quando ela foi recebida da outra pessoa.
  if (!publicName && !fromMe) {
    publicName = firstName([
      item?.pushName,
      item?.data?.pushName,
      envelope?.pushName,
    ], phone);
  }

  return {
    name: savedName || publicName || `WhatsApp ${phone}`,
    source: savedName
      ? 'agenda'
      : publicName
        ? 'perfil_whatsapp'
        : 'numero',
  };
}

function isProvisionalName(name, phone) {
  const current = String(name ?? '').trim();

  return (
    !current ||
    current === `WhatsApp ${phone}` ||
    current === phone ||
    current === `+${phone}`
  );
}

/**
 * Import from webhook or Evolution history,
 * including media-only messages.
 */
export async function importEvolutionMessage({
  orgId,
  integrationId = null,
  item,
  envelope = {},
  expectedPhone = null,
  triggerAutomations = false,
}) {
  const key = item?.key ?? item?.data?.key ?? {};

  if (!key.id) {
    return ignored('ignored_missing_id');
  }

  const fromMe = [true, 'true', 1, '1'].includes(
    key.fromMe
  );

  const jid = String(key.remoteJid ?? '');

  if (
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter')
  ) {
    return ignored('ignored_non_private');
  }

  const phone = inboundPhone(item, envelope);

  if (!phone) {
    return ignored('ignored_phone_unresolved');
  }

  if (
    expectedPhone &&
    phone !== digits(expectedPhone)
  ) {
    return ignored('ignored_other_contact');
  }

  const media = identifyEvolutionMedia(item);

  const text =
    getEvolutionText(item) ??
    media?.caption ??
    '';

  if (!String(text).trim() && !media) {
    return ignored('ignored_unsupported_type');
  }

  const body =
    String(text).trim() ||
    `[${mediaLabel(media.type)}]`;

  const primary = await prisma.integration.findFirst({
    where: {
      org_id: orgId,
      type: 'whatsapp',
    },
    orderBy: [
      { created_at: 'asc' },
      { id: 'asc' },
    ],
    select: {
      id: true,
    },
  });

  const channelId =
    integrationId ??
    primary?.id ??
    null;

  const messageId = stableMessageId(
    channelId === primary?.id
      ? String(key.id)
      : `${channelId}:${key.id}`
  );

  // Mensagens enviadas pelo painel ja sao salvas
  // em sendEvolutionText. Evita duplicacao.
  if (fromMe) {
    const previouslySent =
      await prisma.webhookEvent.findFirst({
        where: {
          org_id: orgId,
          source: 'evolution_outbound',
          event_type: 'message_accepted',
          payload: {
            path: '$.provider_message_id',
            equals: String(key.id),
          },
        },
        select: {
          id: true,
        },
      });

    if (previouslySent) {
      return ignored('already_sent_from_panel');
    }
  }

  const result = await withConversationIdentityLock(
    {
      orgId,
      integrationId: channelId,
      phone,
    },
    async () => {
      // Evita processamento duplicado.
      if (
        await prisma.message.findUnique({
          where: {
            id: messageId,
          },
          select: {
            id: true,
          },
        })
      ) {
        return ignored('duplicate');
      }

      let contact = await prisma.contact.findFirst({
        where: {
          org_id: orgId,
          OR: [
            { phone },
            { phone: `+${phone}` },
          ],
        },
        select: {
          id: true,
          phone: true,
          name: true,
        },
      });

      if (!contact) {
        const known = await prisma.contact.findMany({
          where: {
            org_id: orgId,
          },
          select: {
            id: true,
            phone: true,
            name: true,
          },
          take: 10000,
        });

        contact = known.find(
          c => digits(c.phone) === phone
        );
      }

      // Consulta o WhatsApp apenas para contatos novos
      // ou contatos com nome provisório.
      const needsName =
        !contact ||
        isProvisionalName(contact.name, phone);

      if (needsName) {
        const resolved = await getWhatsAppContactName({
          orgId,
          integrationId: channelId,
          phone,
          item,
          envelope,
          fromMe,
        });

        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: randomUUID(),
              org_id: orgId,
              phone: `+${phone}`,
              name: resolved.name,
              custom_fields: {},
            },
          });

          console.info('[Contacts] Contato criado:', {
            contactId: contact.id,
            source: resolved.source,
            name: resolved.name,
          });
        } else if (
          resolved.source !== 'numero' &&
          resolved.name !== contact.name
        ) {
          // Atualiza apenas nomes provisórios.
          // Não sobrescreve nomes já cadastrados.
          contact = await prisma.contact.update({
            where: {
              id: contact.id,
            },
            data: {
              name: resolved.name,
            },
          });

          console.info('[Contacts] Nome atualizado:', {
            contactId: contact.id,
            source: resolved.source,
            name: resolved.name,
          });
        }
      }

      const { conversation, created } =
        await getOrCreateConversation(prisma, {
          orgId,
          contactId: contact.id,
          integrationId: channelId,
        });

      const isNew = !fromMe && (
        created ||
        await prisma.message.count({
          where: {
            org_id: orgId,
            conversation_id: conversation.id,
            sender_type: 'contact',
          },
        }) === 0
      );

      const timestamp = validTime(
        item?.messageTimestamp ??
        item?.data?.messageTimestamp
      );

      try {
        await prisma.$transaction(async tx => {
          await tx.message.create({
            data: {
              id: messageId,
              org_id: orgId,
              conversation_id: conversation.id,
              sender_type: fromMe
                ? 'agent'
                : 'contact',
              body: body.slice(0, 10000),
              channel: 'whatsapp',
              media_type: media?.type ?? null,
              media_mime: media?.mime ?? null,
              media_name: media?.name ?? null,
              media_size: media?.size ?? null,
              media_message: media?.message ?? null,
              status: fromMe
                ? 'sent'
                : 'received',
              is_internal: false,
              created_at: timestamp,
            },
          });

          if (!fromMe) {
            await tx.conversation.update({
              where: {
                id: conversation.id,
              },
              data: {
                unread_count: {
                  increment: 1,
                },
                ...(
                  ['closed', 'resolved'].includes(
                    conversation.status
                  )
                    ? { status: 'open' }
                    : {}
                ),
              },
            });
          }

          await tx.conversation.updateMany({
            where: {
              id: conversation.id,
              last_message_at: {
                lt: timestamp,
              },
            },
            data: {
              last_message_at: timestamp,
            },
          });
        });
      } catch (error) {
        if (error?.code === 'P2002') {
          return ignored('duplicate');
        }

        throw error;
      }

      return {
        outcome: 'received',
        conversationId: conversation.id,
        isNew,
      };
    }
  );

  if (
    result.outcome === 'received' &&
    !fromMe &&
    triggerAutomations
  ) {
    try {
      await processIncomingWorkflows({
        orgId,
        conversationId: result.conversationId,
        text: body,
        isNew: result.isNew,
        messageId,
      });
    } catch (error) {
      console.error(
        '[Workflow] Falha apos mensagem recebida:',
        {
          conversationId: result.conversationId,
          messageId,
          error: error.message,
        }
      );
    }
  }

  if (result.outcome === 'received') {
    return {
      outcome: fromMe
        ? 'sent_from_phone'
        : 'received',
      conversationId: result.conversationId,
    };
  }

  return result;
}
