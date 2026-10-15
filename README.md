<div align="center">
  <img src="https://media.giphy.com/media/Ll22OhMLAlVDb8UQWe/giphy.gif" width="120" alt="Whats-Guru" />
  <h1>💬 Whats-Guru</h1>
  <p>Plataforma de atendimento WhatsApp, caixa de entrada, contatos, CRM e automações para equipes.</p>

  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-3178C6?style=for-the-badge" alt="React + TypeScript" />
  <img src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-43853D?style=for-the-badge" alt="Node.js + Express" />
  <img src="https://img.shields.io/badge/Banco-MySQL-4479A1?style=for-the-badge" alt="MySQL" />
  <img src="https://img.shields.io/badge/WhatsApp-Evolution%20API-25D366?style=for-the-badge" alt="Evolution API" />
</div>

📖 Visão Geral
O Whats-Guru (nome interno herdado do código: Converso) é uma plataforma web responsiva de atendimento multicanal e CRM, criada originalmente no Bolt.new e posteriormente migrada para execução independente em ambiente local.
O sistema reúne dashboard, caixa de entrada, contatos, funil CRM (Kanban), chatbots, automações, campanhas, agendamentos, relatórios, equipes e integrações. O objetivo da migração foi preservar a interface e os fluxos do projeto original, substituindo a infraestrutura Supabase por uma API própria e um banco MySQL.
A versão local utiliza React + TypeScript + Vite no frontend, Node.js + Express na API, Prisma ORM para acessar o MySQL e JWT na autenticação. O WhatsApp pode ser configurado nas modalidades API oficial da Meta e API não oficial via Evolution API. A Evolution pode estar em um contêiner Docker, com instância configurada pelo painel de Integrações.
Situação atual: login, conexão da API com MySQL (24/24 tabelas) e conexão de uma instância Evolution (state: open) foram confirmados durante a implantação local. O usuário relatou que a implementação está funcionando, mas ainda há ajustes pendentes. Isso não comprova todos os fluxos de recebimento, campanhas, chatbots, automações ou publicação em produção.

Supabase: o arquivo src/lib/supabase.ts permanece como adaptador de compatibilidade para páginas que usam a sintaxe antiga supabase.from(...); na versão migrada analisada, ele chama a API local. A dependência @supabase/supabase-js e arquivos legados do projeto podem permanecer no repositório, mas não são o banco operacional desta arquitetura. Não remover esses arquivos sem verificar importações e compilar novamente.

🎯 Objetivos
- Centralizar atendimentos e conversas de WhatsApp em uma caixa de entrada.
- Organizar contatos, etiquetas e oportunidades em CRM Kanban.
- Integrar o WhatsApp oficial (Meta) e o não oficial (Evolution API), preservando ambas as opções.
- Consultar histórico de mensagens e registrar informações de atendimento.
- Gerenciar organizações, membros, equipes e permissões.
- Criar fluxos de chatbot e regras de automação.
- Preparar campanhas segmentadas e agendamentos.
- Exibir relatórios e indicadores de operação.
- Manter os dados do sistema em MySQL gerenciado pela API Node.js.
- Desenvolver localmente e preparar publicação online posteriormente.
🚀 Tecnologias Utilizadas
<div align="left">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" height="30" alt="React" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" height="30" alt="TypeScript" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vitejs/vitejs-original.svg" height="30" alt="Vite" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" height="30" alt="Node.js" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/express/express-original.svg" height="30" alt="Express" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg" height="30" alt="MySQL" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/prisma/prisma-original.svg" height="30" alt="Prisma" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tailwindcss/tailwindcss-original.svg" height="30" alt="Tailwind CSS" />
</div>

Camada	Tecnologia	Observação
Frontend	React 18, TypeScript, Vite 5	Interface web responsiva
UI	Tailwind CSS, Lucide React	Preservação da interface original
Backend	Node.js, Express 5	API REST em server/
Banco	MySQL	Banco local converso_local
ORM	Prisma 6.19.3	Mapeamento das 24 tabelas
Autenticação	JWT, bcryptjs	Conta e sessão gerenciadas pela API local
Integração WhatsApp não oficial	Evolution API	Instância no Docker e API key do provedor
Integração WhatsApp oficial	Meta WhatsApp Business Platform	Caminho separado, sujeito às credenciais oficiais
Segurança/API	Helmet, CORS, rate limiting, Zod	Proteções implementadas no backend


Não usamos Supabase/PostgreSQL como banco operacional desta versão. O Supabase fazia parte da arquitetura original; arquivos e nomes herdados podem continuar no código apenas para compatibilidade ou histórico.
🚀 Funcionalidades
As marcações [x] indicam implementação identificada e/ou validação relatada na instalação local. [ ] indica fluxo ainda pendente de confirmação integral ou trabalho adicional; não confundir existência de tela com operação completa.
- [x] Cadastro e login local com e-mail e senha.
- [x] Sessão autenticada por JWT e logout.
- [x] Organização e associação de usuários por papéis (owner, admin, agent).
- [x] Dashboard com indicadores consultados na API local.
- [x] Cadastro e consulta de contatos no MySQL (testados no ambiente local).
- [x] Estrutura de caixa de entrada com conversas e mensagens.
- [x] Estrutura de CRM Kanban, etiquetas, etapas e oportunidades.
- [x] Telas de chatbots, automações, campanhas e agendamentos preservadas na migração.
- [x] Telas de relatórios e equipes.
- [x] Integração configurável com Evolution API e API oficial da Meta.
- [x] Geração de QR Code da Evolution na interface (confirmada pelo usuário).
- [x] Instância Evolution whats-guru respondendo open em teste direto.
- [x] API local conectada ao banco converso_local, com 24/24 tabelas confirmadas.
- [ ] Validação automatizada e abrangente de envio e recebimento pela Evolution em diferentes cenários e reinícios.
- [ ] Validar webhook de entrada e atualização de status de mensagens na operação real.
- [ ] Testar de ponta a ponta integração com API oficial da Meta.
- [ ] Validar execução de chatbots, automações, campanhas e agendamentos (não apenas seus cadastros).
- [ ] Verificar permissões por organização e cobertura de testes de regressão.
- [ ] Revisão de segurança, backup, HTTPS, logs e preparação para produção.
🏗 Arquitetura do Sistema
```mermaid
flowchart TD
    A["Frontend - React / TypeScript / Vite"] --> B["API local - Node.js / Express"]
    B --> C["Autenticacao JWT"]
    B --> D["Prisma ORM"]
    D --> E["MySQL - converso_local"]
    B --> F["Integracoes WhatsApp"]
    F --> G["Evolution API - Docker"]
    F --> H["Meta WhatsApp Business Platform"]
    G --> I["WhatsApp"]
    H --> I
    G -. "Webhooks / eventos a validar" .-> B
```
Estrutura principal:
whats-guru/
├── src/                        # Frontend React / TypeScript
│   ├── pages/                  # Dashboard, Inbox, Contatos, CRM, Integrações etc.
│   ├── components/             # Componentes de interface
│   ├── contexts/               # Sessão e organização
│   └── lib/
│       ├── api.ts              # Cliente da API Node local
│       └── supabase.ts         # Adaptador legado -> API local (não banco Supabase)
├── server/                     # Backend próprio
│   ├── src/
│   │   ├── index.js            # Inicialização da API
│   │   ├── app.js              # Express e montagem das rotas
│   │   ├── routes/             # Autenticação, contatos, conversas, integrações etc.
│   │   ├── services/           # Comunicação com provedores WhatsApp
│   │   └── middleware/         # Autorização e contexto de organização
│   ├── prisma/schema.prisma    # Modelos Prisma para MySQL
│   ├── scripts/                # Ferramentas de validação do banco
│   ├── .env                    # Configurações privadas (não versionar)
│   └── package.json
├── supabase/                   # Legado da exportação Bolt (não necessário ao banco atual)
├── .env                        # Configuração do frontend; revisar antes de publicar
├── package.json                # Scripts frontend
└── vite.config.ts
Banco de dados: MySQL converso_local, com 24 tabelas verificadas. A tabela users foi acrescentada para autenticação própria, substituindo a dependência do Supabase Auth. O banco também contém organizações, membros, contatos, conversas, mensagens, integrações e credenciais de integração. A conexão Evolution é externa ao MySQL; o MySQL armazena informações e configurações, enquanto o serviço Evolution se comunica com o WhatsApp.
📦 Instalação
1. Pré-requisitos
Instale:
- Node.js — Node.js 20.19+; ambiente já testado com v24.21.0 e npm 11.19.0.
- Git — recomendado para versionamento.
- MySQL Server e MySQL Workbench — banco local.
- VS Code — recomendado.
- Docker Desktop — caso a Evolution API rode em contêiner no próprio computador.
- Instância Evolution API configurada, para atendimento por WhatsApp não oficial.
2. Baixar o projeto
Clone um repositório privado, se existir, ou utilize a pasta local do projeto:
git clone <URL_DO_REPOSITORIO>
cd whats-guru
No computador em que o projeto foi configurado: C:\Users\ImportsBR-PC1\Documents\Projetos\whats-guru. Não há URL de repositório confirmada nesta documentação.
3. Instalar as dependências
Frontend — dentro de whats-guru/:
npm install
Backend — dentro de whats-guru/server/:
cd server
npm install
npm run db:validate
npm run db:generate
As duas pastas possuem arquivos package.json distintos. Execute npm na pasta correspondente.

4. Configurar as variáveis de ambiente
No frontend (whats-guru/.env), configure o endereço da API:
VITE_API_URL=http://127.0.0.1:4000
No backend (whats-guru/server/.env):
NODE_ENV=development
HOST=127.0.0.1
PORT=4000
DATABASE_URL="mysql://converso_app:SENHA_LOCAL@127.0.0.1:3306/converso_local"
JWT_SECRET="SEGREDO_LONGO_ALEATORIO"
JWT_EXPIRES_IN=12h
ALLOW_REGISTRATION=true
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
INTEGRATION_ENCRYPTION_KEY="CHAVE_DE_CRIPTOGRAFIA_EXISTENTE"
EVOLUTION_ALLOW_LOCAL_HTTP=true
Atenção: exemplos acima contêm marcadores, não credenciais reais. Preserve a INTEGRATION_ENCRYPTION_KEY que já está em uso: alterá-la pode impedir a leitura das credenciais de integrações existentes. No ambiente local, EVOLUTION_ALLOW_LOCAL_HTTP=true foi usado para permitir Evolution em loopback, como http://127.0.0.1:8080; confira a versão instalada antes de configurar.
Se a senha MySQL contiver caracteres reservados como @, #, : ou /, codifique-os na URL. Jamais inclua credenciais em arquivos versionados no Git. Não use variáveis VITE_ para segredos, pois ficam acessíveis no navegador.
5. Preparar o banco de dados
O banco utilizado é MySQL, não Supabase.
O banco converso_local e as 24 tabelas já foram criados no ambiente de desenvolvimento. Para validar a conexão existente, execute na pasta server:
npm run db:validate
npm run db:generate
npm run db:check
Resultado confirmado nessa instalação:
Banco: converso_local | Tabelas: 24/24
OK: conexao MySQL e estrutura base presentes.
Para uma instalação nova, utilize o script SQL da Etapa 2 da migração e configure um usuário MySQL com permissões apenas no banco da aplicação. Não execute novamente scripts de criação sem revisar o estado do banco e efetuar backup. prisma generate cria o cliente JavaScript; não cria sozinho as tabelas.
6. Iniciar o projeto
Abra dois terminais.
Terminal 1 — API:
cd server
npm run dev
Acesse http://127.0.0.1:4000/api/health. Resposta confirmada no ambiente local:
{"api":"online","mysql":"connected","tables":24,"expected_tables":24}
Terminal 2 — Frontend: abra outro terminal na pasta raiz whats-guru/:
npm run dev
Acesse http://localhost:5173.
Comandos adicionais:
# Frontend (raiz)
npm run typecheck
npm run lint
npm run build

# Backend (pasta server)
npm test
7. Acesso inicial
O projeto utiliza cadastro e login próprios, por e-mail e senha, com autenticação JWT. O cadastro depende da configuração ALLOW_REGISTRATION.
Não há usuário nem senha administrativa universal definidos neste README. Utilize uma conta que tenha sido criada no próprio Whats-Guru. As senhas ficam protegidas no banco; não devem ser publicadas em documentação.
Configuração Evolution API: abra Integrações → WhatsApp → API não oficial (Evolution API) e informe a URL do servidor Evolution, o nome da instância e a API Key do provedor. Quando rodar no Docker local, utilize o endereço e a porta efetivamente publicados. O QR Code permite parear a instância. O estado open, confirmado no endpoint instance/connectionState, indica uma sessão conectada no provedor.
Usuário padrão para login
- E-mail: conta criada no próprio Whats-Guru (não existe credencial universal padrão documentada).
- Senha: senha definida pelo usuário no cadastro.
- Banco utilizado: converso_local — MySQL local.
- API local: http://127.0.0.1:4000.
- Frontend: http://localhost:5173.
- WhatsApp: Evolution API ou Meta, conforme a integração da organização.
<div align="center">
  <strong>Whats-Guru</strong>
  <p>Atendimento inteligente, relacionamento e gestão em um só lugar.</p>
  <sub>Documentação atualizada para a migração Node.js + MySQL. Integrações externas e funcionalidades operacionais devem ser verificadas no ambiente de implantação antes da publicação online.</sub>
</div>