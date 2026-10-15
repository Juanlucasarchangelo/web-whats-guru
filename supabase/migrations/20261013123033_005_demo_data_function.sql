/*
# Converso CRM - Demo Data Seeding Function

Creates a SECURITY DEFINER function that seeds fictitious demo data for a new organization.
This is called from the frontend after signup to populate the account with sample data so the
user can explore all features immediately. All demo data is marked with is_demo = true.

## Function
- seed_demo_data(org_uuid) → inserts demo contacts, conversations, messages, tags, quick replies,
  chatbots, automations, campaigns, schedules, and integrations for the given org.
- All data is clearly identified as fictitious (is_demo = true, names contain "Demonstração").

## Security
- SECURITY DEFINER so it can insert on behalf of the user
- Only callable by authenticated users who are members of the org
*/

CREATE OR REPLACE FUNCTION seed_demo_data(target_org_uuid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_member_count integer;
  v_tag1 uuid;
  v_tag2 uuid;
  v_tag3 uuid;
  v_tag4 uuid;
  v_tag5 uuid;
  v_contact1 uuid;
  v_contact2 uuid;
  v_contact3 uuid;
  v_contact4 uuid;
  v_contact5 uuid;
  v_contact6 uuid;
  v_contact7 uuid;
  v_contact8 uuid;
  v_conv1 uuid;
  v_conv2 uuid;
  v_conv3 uuid;
  v_conv4 uuid;
  v_conv5 uuid;
  v_chatbot1 uuid;
  v_auto1 uuid;
  v_auto2 uuid;
  v_camp1 uuid;
  v_result jsonb;
BEGIN
  -- Verify caller is a member of the org
  SELECT count(*) INTO v_member_count
  FROM org_members
  WHERE org_id = target_org_uuid AND user_id = v_user;

  IF v_member_count = 0 THEN
    RETURN jsonb_build_object('error', 'not_a_member');
  END IF;

  -- Tags
  INSERT INTO tags (org_id, name, color) VALUES
    (target_org_uuid, 'VIP', '#ef4444'),
    (target_org_uuid, 'Cliente Novo', '#22c55e'),
    (target_org_uuid, 'Suporte', '#3b82f6'),
    (target_org_uuid, 'Vendas', '#f59e0b'),
    (target_org_uuid, 'Urgente', '#ec4899')
  RETURNING id INTO v_tag1, v_tag2, v_tag3, v_tag4, v_tag5;

  -- Contacts (fictitious)
  INSERT INTO contacts (org_id, name, email, phone, crm_stage, crm_value, is_demo, custom_fields) VALUES
    (target_org_uuid, 'Ana Martins (Demo)', 'ana.martins.demo@emailficticio.com', '+55 11 98888-1001', 'lead', 2500.00, true, '{"empresa":"TechSol Demo","cargo":"Gerente de Marketing"}'::jsonb),
    (target_org_uuid, 'Bruno Costa (Demo)', 'bruno.costa.demo@emailficticio.com', '+55 11 98888-1002', 'negotiation', 8500.00, true, '{"empresa":"InnovaLab Demo","cargo":"CEO"}'::jsonb),
    (target_org_uuid, 'Carla Souza (Demo)', 'carla.souza.demo@emailficticio.com', '+55 21 97777-2001', 'won', 12000.00, true, '{"empresa":"BetaCorp Demo","cargo":"Diretora de Vendas"}'::jsonb),
    (target_org_uuid, 'Diego Ferreira (Demo)', 'diego.ferreira.demo@emailficticio.com', '+55 31 96666-3001', 'lead', 1500.00, true, '{"empresa":"StartupX Demo","cargo":"Founder"}'::jsonb),
    (target_org_uuid, 'Elena Rocha (Demo)', 'elena.rocha.demo@emailficticio.com', '+55 41 95555-4001', 'qualified', 5000.00, true, '{"empresa":"GlobalTech Demo","cargo":"CTO"}'::jsonb),
    (target_org_uuid, 'Felipe Alves (Demo)', 'felipe.alves.demo@emailficticio.com', '+55 51 94444-5001', 'negotiation', 7800.00, true, '{"empresa":"DataWave Demo","cargo":"Head de Compras"}'::jsonb),
    (target_org_uuid, 'Gabriela Lima (Demo)', 'gabriela.lima.demo@emailficticio.com', '+55 61 93333-6001', 'won', 15000.00, true, '{"empresa":"PrimeSys Demo","cargo":"VP Operações"}'::jsonb),
    (target_org_uuid, 'Henrique Dias (Demo)', 'henrique.dias.demo@emailficticio.com', '+55 71 92222-7001', 'lost', 0.00, true, '{"empresa":"OldCo Demo","cargo":"Gerente"}'::jsonb)
  RETURNING id INTO v_contact1, v_contact2, v_contact3, v_contact4, v_contact5, v_contact6, v_contact7, v_contact8;

  -- Contact tags
  INSERT INTO contact_tags (contact_id, tag_id) VALUES
    (v_contact1, v_tag2), (v_contact1, v_tag4),
    (v_contact2, v_tag1), (v_contact2, v_tag4),
    (v_contact3, v_tag1),
    (v_contact5, v_tag3),
    (v_contact6, v_tag4), (v_contact6, v_tag5),
    (v_contact7, v_tag1);

  -- Conversations
  INSERT INTO conversations (org_id, contact_id, channel, status, assigned_to, unread_count, last_message_at, is_demo) VALUES
    (target_org_uuid, v_contact1, 'whatsapp', 'open', v_user, 2, now() - interval '5 minutes', true),
    (target_org_uuid, v_contact2, 'whatsapp', 'open', v_user, 0, now() - interval '1 hour', true),
    (target_org_uuid, v_contact3, 'whatsapp', 'open', NULL, 1, now() - interval '2 hours', true),
    (target_org_uuid, v_contact4, 'whatsapp', 'pending', NULL, 0, now() - interval '3 hours', true),
    (target_org_uuid, v_contact5, 'whatsapp', 'closed', v_user, 0, now() - interval '1 day', true)
  RETURNING id INTO v_conv1, v_conv2, v_conv3, v_conv4, v_conv5;

  -- Conversation tags
  INSERT INTO conversation_tags (conversation_id, tag_id) VALUES
    (v_conv1, v_tag2), (v_conv1, v_tag4),
    (v_conv2, v_tag1), (v_conv2, v_tag5),
    (v_conv3, v_tag3),
    (v_conv4, v_tag2);

  -- Messages for conv1 (Ana Martins - open, 2 unread)
  INSERT INTO messages (conversation_id, org_id, sender_type, sender_id, body, channel, status, is_bot, created_at) VALUES
    (v_conv1, target_org_uuid, 'contact', NULL, 'Olá! Vi o anúncio de vocês e gostaria de saber mais sobre o plano profissional.', 'whatsapp', 'delivered', false, now() - interval '30 minutes'),
    (v_conv1, target_org_uuid, 'agent', v_user, 'Olá Ana! Que bom ter você aqui. O plano profissional inclui atendimento ilimitado, automações e relatórios avançados. Posso te enviar mais detalhes?', 'whatsapp', 'read', false, now() - interval '28 minutes'),
    (v_conv1, target_org_uuid, 'contact', NULL, 'Sim, por favor! Também queria saber sobre integração com WhatsApp.', 'whatsapp', 'delivered', false, now() - interval '5 minutes'),
    (v_conv1, target_org_uuid, 'contact', NULL, 'E qual o prazo de implementação?', 'whatsapp', 'delivered', false, now() - interval '4 minutes');

  -- Messages for conv2 (Bruno Costa - open, 0 unread)
  INSERT INTO messages (conversation_id, org_id, sender_type, sender_id, body, channel, status, is_bot, created_at) VALUES
    (v_conv2, target_org_uuid, 'contact', NULL, 'Bom dia! Preciso de uma proposta para 50 usuários.', 'whatsapp', 'read', false, now() - interval '2 hours'),
    (v_conv2, target_org_uuid, 'agent', v_user, 'Bom dia Bruno! Claro, vou preparar uma proposta personalizada para 50 usuários. Você precisa de algum recurso específico?', 'whatsapp', 'read', false, now() - interval '1 hour 58 minutes'),
    (v_conv2, target_org_uuid, 'contact', NULL, 'Precisamos de CRM kanban e automações de marketing.', 'whatsapp', 'read', false, now() - interval '1 hour 30 minutes'),
    (v_conv2, target_org_uuid, 'agent', v_user, 'Perfeito! Ambos estão inclusos no plano Enterprise. Vou enviar a proposta em PDF ainda hoje.', 'whatsapp', 'read', false, now() - interval '1 hour');

  -- Messages for conv3 (Carla Souza - open, 1 unread, unassigned)
  INSERT INTO messages (conversation_id, org_id, sender_type, sender_id, body, channel, status, is_bot, created_at) VALUES
    (v_conv3, target_org_uuid, 'contact', NULL, 'Estou com um problema no acesso ao painel.', 'whatsapp', 'delivered', false, now() - interval '2 hours 10 minutes'),
    (v_conv3, target_org_uuid, 'contact', NULL, 'Aparece um erro 500 na tela de login.', 'whatsapp', 'delivered', false, now() - interval '2 hours');

  -- Messages for conv4 (Diego Ferreira - pending)
  INSERT INTO messages (conversation_id, org_id, sender_type, sender_id, body, channel, status, is_bot, created_at) VALUES
    (v_conv4, target_org_uuid, 'contact', NULL, 'Qual o preço do plano básico?', 'whatsapp', 'read', false, now() - interval '3 hours'),
    (v_conv4, target_org_uuid, 'bot', NULL, 'Olá! O plano básico custa R$ 99/mês e inclui 1.000 conversas, 2 usuários e relatórios básicos. Um atendente humano vai continuar o atendimento.', 'whatsapp', 'read', true, now() - interval '2 hours 55 minutes');

  -- Messages for conv5 (Elena Rocha - closed)
  INSERT INTO messages (conversation_id, org_id, sender_type, sender_id, body, channel, status, is_bot, created_at) VALUES
    (v_conv5, target_org_uuid, 'contact', NULL, 'Obrigada pelo atendimento, resolveu meu problema!', 'whatsapp', 'read', false, now() - interval '1 day 1 hour'),
    (v_conv5, target_org_uuid, 'agent', v_user, 'Disponha, Elena! Estamos à disposição sempre que precisar. :)', 'whatsapp', 'read', false, now() - interval '1 day');

  -- Internal notes
  INSERT INTO internal_notes (conversation_id, org_id, author_id, body) VALUES
    (v_conv1, target_org_uuid, v_user, 'Cliente interessada no plano profissional. Enviar proposal até amanhã.'),
    (v_conv2, target_org_uuid, v_user, 'Bruno é CEO da InnovaLab, 50 funcionários. Oportunidade grande - priorizar proposta.'),
    (v_conv3, target_org_uuid, v_user, 'Problema técnico - encaminhar para suporte N2 se persistir.');

  -- Quick replies
  INSERT INTO quick_replies (org_id, shortcut, title, body, created_by) VALUES
    (target_org_uuid, '/ola', 'Saudação', 'Olá! Como posso ajudar você hoje?', v_user),
    (target_org_uuid, '/obrigado', 'Agradecimento', 'Muito obrigado pelo seu contato! Estamos à disposição sempre que precisar.', v_user),
    (target_org_uuid, '/horario', 'Horário de Funcionamento', 'Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Aos sábados das 9h às 13h.', v_user),
    (target_org_uuid, '/precos', 'Tabela de Preços', 'Temos três planos disponíveis: Básico (R$ 99/mês), Profissional (R$ 299/mês) e Enterprise (sob consulta). Posso te enviar mais detalhes?', v_user),
    (target_org_uuid, '/transferir', 'Transferência', 'Vou transferir você para um especialista da área. Um momento, por favor.', v_user);

  -- Chatbot
  INSERT INTO chatbots (org_id, name, description, flow, status, trigger_channel, trigger_keyword, created_by) VALUES
    (target_org_uuid, 'Bot de Boas-vindas (Demo)', 'Atendimento inicial automatizado para triagem de novos contatos',
    jsonb_build_object(
      'nodes', jsonb_build_array(
        jsonb_build_object('id', 'start', 'type', 'message', 'data', jsonb_build_object('text', 'Olá! Bem-vindo à nossa empresa. Como podemos ajudar?'), 'position', jsonb_build_object('x', 250, 'y', 50)),
        jsonb_build_object('id', 'q1', 'type', 'question', 'data', jsonb_build_object('text', 'Qual o motivo do seu contato?', 'options', jsonb_build_array('Vendas','Suporte','Informações')), 'position', jsonb_build_object('x', 250, 'y', 180)),
        jsonb_build_object('id', 'cond1', 'type', 'condition', 'data', jsonb_build_object('field', 'resposta', 'operator', 'equals', 'value', 'Suporte'), 'position', jsonb_build_object('x', 100, 'y', 320)),
        jsonb_build_object('id', 'cond2', 'type', 'condition', 'data', jsonb_build_object('field', 'resposta', 'operator', 'equals', 'value', 'Vendas'), 'position', jsonb_build_object('x', 400, 'y', 320)),
        jsonb_build_object('id', 'msg_suporte', 'type', 'message', 'data', jsonb_build_object('text', 'Vou direcionar você para nossa equipe de suporte. Um atendente vai responder em instantes.'), 'position', jsonb_build_object('x', 50, 'y', 460)),
        jsonb_build_object('id', 'msg_vendas', 'type', 'message', 'data', jsonb_build_object('text', 'Excelente! Nosso time de vendas vai adorar falar com você. Já te conecto com um especialista.'), 'position', jsonb_build_object('x', 400, 'y', 460)),
        jsonb_build_object('id', 'assign_suporte', 'type', 'assign', 'data', jsonb_build_object('team', 'Suporte'), 'position', jsonb_build_object('x', 50, 'y', 580)),
        jsonb_build_object('id', 'tag_lead', 'type', 'tag', 'data', jsonb_build_object('tag', 'Cliente Novo'), 'position', jsonb_build_object('x', 400, 'y', 580)),
        jsonb_build_object('id', 'close', 'type', 'close', 'data', jsonb_build_object('text', 'Conversa encaminhada com sucesso!'), 'position', jsonb_build_object('x', 250, 'y', 700))
      ),
      'edges', jsonb_build_array(
        jsonb_build_object('from', 'start', 'to', 'q1'),
        jsonb_build_object('from', 'q1', 'to', 'cond1'),
        jsonb_build_object('from', 'q1', 'to', 'cond2'),
        jsonb_build_object('from', 'cond1', 'to', 'msg_suporte'),
        jsonb_build_object('from', 'cond2', 'to', 'msg_vendas'),
        jsonb_build_object('from', 'msg_suporte', 'to', 'assign_suporte'),
        jsonb_build_object('from', 'msg_vendas', 'to', 'tag_lead'),
        jsonb_build_object('from', 'assign_suporte', 'to', 'close'),
        jsonb_build_object('from', 'tag_lead', 'to', 'close')
      )
    ),
    'active', 'whatsapp', 'inicio', v_user)
  RETURNING id INTO v_chatbot1;

  -- Automations
  INSERT INTO automations (org_id, name, description, trigger, actions, status, created_by) VALUES
    (target_org_uuid, 'Auto-resposta fora do horário (Demo)', 'Envia mensagem automática quando contato fora do horário comercial',
     jsonb_build_object('type', 'out_of_hours', 'hours', '18:00-08:00', 'weekends', true),
     jsonb_build_array(jsonb_build_object('type', 'send_message', 'text', 'Recebemos sua mensagem! Nosso horário de atendimento é seg-sex, 8h-18h. Retornaremos assim que possível.')),
     'active', v_user),
    (target_org_uuid, 'Atribuir automaticamente (Demo)', 'Atribui conversas não respondidas após 10 minutos ao time de Suporte',
     jsonb_build_object('type', 'no_response', 'timeout_minutes', 10),
     jsonb_build_array(jsonb_build_object('type', 'assign_team', 'team', 'Suporte'), jsonb_build_object('type', 'add_tag', 'tag', 'Urgente')),
     'active', v_user)
  RETURNING id INTO v_auto1, v_auto2;

  -- Campaign
  INSERT INTO campaigns (org_id, name, message, channel, segment_tags, segment_stage, status, consent_required, daily_limit, sent_count, delivered_count, read_count, failed_count, created_by) VALUES
    (target_org_uuid, 'Campanha de Black Friday (Demo)', 'Olá! A Black Friday chegou! Use o cupom DEMO50 e ganhe 50% de desconto em todos os planos. Válido até 30/11. Não perca!', 'whatsapp', ARRAY['Cliente Novo'], 'lead', 'scheduled', true, 50, 0, 0, 0, 0, v_user)
  RETURNING id INTO v_camp1;

  -- Schedules
  INSERT INTO schedules (org_id, contact_id, title, message, scheduled_at, channel, status, created_by) VALUES
    (target_org_uuid, v_contact1, 'Ligar para Ana Martins (Demo)', 'Retornar contato sobre plano profissional', now() + interval '1 day', 'whatsapp', 'pending', v_user),
    (target_org_uuid, v_contact2, 'Enviar proposta para Bruno (Demo)', 'Proposta personalizada para 50 usuários - plano Enterprise', now() + interval '2 hours', 'whatsapp', 'pending', v_user),
    (target_org_uuid, v_contact5, 'Follow-up Elena (Demo)', 'Verificar se está tudo funcionando bem após o suporte', now() + interval '3 days', 'whatsapp', 'pending', v_user);

  -- Integrations (all in demo/disconnected mode)
  INSERT INTO integrations (org_id, type, name, config, status) VALUES
    (target_org_uuid, 'whatsapp', 'WhatsApp Business (Demo)', jsonb_build_object('phone_number_id', '', 'business_account_id', '', 'demo_mode', true), 'demo'),
    (target_org_uuid, 'ai_provider', 'Provedor de IA (Demo)', jsonb_build_object('provider', 'openai', 'model', 'gpt-4', 'demo_mode', true), 'demo'),
    (target_org_uuid, 'webhook', 'Webhook (Demo)', jsonb_build_object('url', '', 'demo_mode', true), 'demo')
  ON CONFLICT (org_id, type) DO NOTHING;

  -- Audit log
  INSERT INTO audit_logs (org_id, user_id, action, entity_type, details) VALUES
    (target_org_uuid, v_user, 'demo_data_seeded', 'organization', jsonb_build_object('contacts', 8, 'conversations', 5, 'tags', 5));

  v_result := jsonb_build_object(
    'success', true,
    'contacts', 8,
    'conversations', 5,
    'tags', 5,
    'quick_replies', 5,
    'chatbots', 1,
    'automations', 2,
    'campaigns', 1,
    'schedules', 3
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated
REVOKE ALL ON FUNCTION seed_demo_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_demo_data(uuid) TO authenticated;
