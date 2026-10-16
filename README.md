<div align="center">
  <h1>💬 Whats-Guru</h1>
  <p>CRM de atendimento com múltiplos números de WhatsApp, equipes e automações.</p>
  <p>
    <img src="https://img.shields.io/badge/React-Vite-149ECA?style=for-the-badge" alt="React e Vite" />
    <img src="https://img.shields.io/badge/API-Node.js%20%2B%20Express-339933?style=for-the-badge" alt="Node e Express" />
    <img src="https://img.shields.io/badge/ORM-Prisma-2D3748?style=for-the-badge" alt="Prisma" />
    <img src="https://img.shields.io/badge/Banco-MySQL-4479A1?style=for-the-badge" alt="MySQL" />
    <img src="https://img.shields.io/badge/WhatsApp-Evolution%20API-25D366?style=for-the-badge" alt="Evolution API" />
  </p>
</div>

---

## 📖 Visão geral

O **Whats-Guru** é uma aplicação web para organizar conversas de WhatsApp, contatos e negociações. O frontend é **React + TypeScript + Vite**; o backend é **Node.js + Express**; os dados do CRM ficam em **MySQL**, acessados pelo **Prisma**.

A conexão com WhatsApp é feita pela **Evolution API**, executada em **Docker Desktop**, em uma pasta independente. Algumas partes internas do código ainda usam o nome técnico **Converso**; não é outro sistema.

## 🎯 Objetivos

- Centralizar atendimentos de diferentes números no mesmo painel.
- Organizar atendentes, equipes e permissões por número.
- Gerenciar contatos, oportunidades e funil CRM Kanban.
- Operar chatbots, automações, campanhas e mensagens agendadas.
- Acompanhar relatórios e dados de atendimento.

## 🚀 Tecnologias utilizadas

<div align="left">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" height="30" alt="React" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" height="30" alt="TypeScript" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vitejs/vitejs-original.svg" height="30" alt="Vite" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" height="30" alt="Node.js" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg" height="30" alt="MySQL" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg" height="30" alt="Docker" />
</div>

## ✅ Funcionalidades

- [x] Login, cadastro de usuários e perfil.
- [x] Caixa de entrada, contatos e CRM Kanban.
- [x] Vários números/instâncias Evolution e permissões por equipe.
- [x] Chatbots e automações.
- [x] Campanhas, agendamentos e relatórios.
- [x] Integrações com WhatsApp via Evolution API.

> O uso com **API oficial da Meta** requer configuração e validação próprias; não é a mesma instalação da Evolution.

## 🏗 Arquitetura

```mermaid
flowchart TD
    A["Navegador: React + Vite :5173"] --> B["API Node + Express :4000"]
    B --> C["Prisma"]
    C --> D["MySQL no Windows :3306"]
    B <--> E["Evolution API no Docker :8080"]
    E --> F["PostgreSQL no Docker"]
    E --> G["Redis no Docker"]
    E <--> H["WhatsApp"]
```

**São dois ambientes separados:** o MySQL guarda os dados do Whats-Guru; o PostgreSQL e o Redis são serviços **internos do Docker para a Evolution**. Não instale PostgreSQL ou Redis manualmente no Windows.

```text
C:\Users\SEU_USUARIO\Documents\Projetos\
├── web-whats-guru\          # Aplicação React + API + Prisma + MySQL
│   ├── README.md
│   ├── package.json          # Frontend
│   ├── src\
│   └── server\
│       ├── .env.example
│       ├── package.json
│       └── prisma\schema.prisma
└── evolution-api\           # Independente do Whats-Guru
    ├── .env
    └── docker.yml
```

---

## 📦 Instalação do zero — Windows

Siga estas etapas **na ordem**, em uma máquina nova. Os comandos de banco abaixo se destinam a uma instalação **vazia**. Não rode `prisma db push` num banco com dados sem backup e revisão.

### 1. Pré-requisitos

Instale **Node.js 20.19+**, **MySQL Server 8+** e **Docker Desktop** (com WSL 2 habilitado). **Git** é necessário se for clonar o repositório. **HeidiSQL** é opcional para visualizar o banco. Abra o Docker Desktop e espere o motor iniciar.

Verifique no PowerShell:

```powershell
node -v
npm -v
docker --version
docker compose version
```

Baixe ou clone **seu repositório do Whats-Guru** e abra a pasta `web-whats-guru`. O repositório precisa incluir `package.json`, `src`, `server` e `server/prisma/schema.prisma`. Não use URLs de GitHub de outros projetos.

### 2. Criar o banco MySQL vazio

**PowerShell (em qualquer pasta):**

```powershell
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS converso_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Digite sua senha de **root do MySQL** quando solicitada. Isso **cria só o banco**, não as tabelas. Se `mysql` não for reconhecido no PowerShell, use o executável `mysql.exe` da pasta `bin` da instalação do MySQL ou execute a mesma instrução no HeidiSQL.

### 3. Configurar e instalar a API

**PowerShell A — pasta `web-whats-guru\server`:**

```powershell
npm install
Copy-Item .env.example .env
node scripts/generate-secret.js
notepad .env
```

O comando `generate-secret.js` gera uma chave aleatória. Execute **três vezes** e use valores diferentes para `JWT_SECRET`, `INTEGRATION_ENCRYPTION_KEY` e `EVOLUTION_WEBHOOK_SECRET`.

Configure as seguintes linhas em **`server/.env`**, mantendo as demais existentes:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=4000
DATABASE_URL="mysql://root:SUA_SENHA_MYSQL@127.0.0.1:3306/converso_local"
JWT_SECRET=CHAVE_ALEATORIA_1
JWT_EXPIRES_IN=12h
ALLOW_REGISTRATION=true
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
INTEGRATION_ENCRYPTION_KEY=CHAVE_ALEATORIA_2
EVOLUTION_ALLOW_LOCAL_HTTP=true
EVOLUTION_AUTO_WEBHOOK=true
EVOLUTION_WEBHOOK_PUBLIC_URL=http://host.docker.internal:4000
EVOLUTION_WEBHOOK_SECRET=CHAVE_ALEATORIA_3
```

Troque as chaves e a senha pelos valores reais. Se a senha MySQL tiver `@`, `#`, `:`, `/`, `%` ou outros caracteres especiais, codifique esses caracteres na URL. A conta `root` é usada **somente para facilitar o desenvolvimento local**; ambientes publicados devem usar usuário próprio e privilégios mínimos. `HOST=0.0.0.0` permite que o contêiner da Evolution chame o webhook do backend Windows; mantenha o acesso protegido pela rede/firewall local.

### 4. Criar todas as tabelas pelo Prisma

**Ainda no PowerShell A, dentro de `server`:**

```powershell
npx prisma validate
npx prisma db push
npx prisma generate
npm run db:check
```

- **`prisma db push` cria as 24 tabelas** com base no `server/prisma/schema.prisma` atualizado, incluindo relacionamentos e campos de múltiplos WhatsApps, campanhas e agendamentos.
- `db:check` deve mostrar `Banco: converso_local | Tabelas: 24/24`.
- **Não importe nenhum `.sql` manualmente.** Não execute `prisma db pull` num banco novo: ele serve para ler um banco existente, não para criar tabelas.
- **Não rode** `upgrade-multi-whatsapp.js` nem `upgrade-operations.js` nessa instalação nova. O schema já inclui os campos finais. Esses scripts são apenas para atualizar bancos antigos.

**Importante:** esta versão do README vem acompanhada de um `schema.prisma` ajustado para permitir a criação do banco pelo Prisma. Se você estiver usando outra versão do repositório, confira se o schema também está atualizado **antes de seguir**. Se `prisma validate` ou `db push` apresentar erro, pare e corrija a causa; não use `--force-reset`.

### 5. Iniciar o backend e o frontend

**PowerShell A — `web-whats-guru\server`:**

```powershell
npm run dev
```

**PowerShell B — `web-whats-guru` (raiz):**

```powershell
npm install
npm run dev
```

Abra:

- **Whats-Guru:** http://localhost:5173
- **Saúde da API:** http://127.0.0.1:4000/api/health

No primeiro acesso, crie seu usuário pela tela de cadastro. O sistema não fornece uma senha administrativa padrão.

### 6. Instalar a Evolution API em pasta separada

**Não coloque a Evolution dentro de `web-whats-guru`.** Crie a pasta irmã `evolution-api`:

```powershell
cd "$HOME\Documents\Projetos"
New-Item -ItemType Directory -Force evolution-api | Out-Null
Set-Location evolution-api
```

Nesta pasta, crie **dois arquivos**: `.env` e `docker.yml`. Você pode copiar os exemplos abaixo ou usar o pacote opcional **`EVOLUTION_API_MODELO.zip`**. Nesse caso, extraia os dois arquivos **diretamente na pasta `evolution-api`**, copie `.env.example` para `.env` e preencha os segredos.

**Conteúdo de `evolution-api\.env`:**

```env
SERVER_NAME=evolution
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=http://localhost:8080
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_CLIENT_NAME=bmclub_evolution
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_HISTORIC=true
CACHE_REDIS_ENABLED=true
CACHE_REDIS_PREFIX_KEY=bmclub_evolution
CACHE_REDIS_SAVE_INSTANCES=true
CACHE_LOCAL_ENABLED=false
AUTHENTICATION_API_KEY=COLE_UMA_CHAVE_ALEATORIA
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
POSTGRES_PASSWORD=SENHA_ALFANUMERICA_FORTE
RABBITMQ_ENABLED=false
S3_ENABLED=false
```

Escolha **outra chave aleatória** para `AUTHENTICATION_API_KEY`. Em `POSTGRES_PASSWORD`, use uma senha forte com letras e números (evita problemas com caracteres especiais na URL da Evolution). **Não deixe as duas variáveis vazias.**

**Conteúdo de `evolution-api\docker.yml`** (mesma configuração usada na máquina que funcionou):

```yaml
services:
  postgres:
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: evolution
    volumes:
      - evolution_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - evolution_redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    env_file:
      - .env
    environment:
      DATABASE_CONNECTION_URI: postgresql://evolution:${POSTGRES_PASSWORD}@postgres:5432/evolution
      CACHE_REDIS_URI: redis://redis:6379/1
    volumes:
      - evolution_instances:/evolution/instances
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  evolution_postgres_data:
  evolution_redis_data:
  evolution_instances:
```

Como o arquivo foi nomeado **`docker.yml`** (e não `compose.yml`), todos os comandos precisam de **`-f docker.yml`**:

**PowerShell C — `evolution-api`:**

```powershell
Copy-Item .env.example .env   # somente se usou o ZIP de modelos
notepad .env
# Preencha AUTHENTICATION_API_KEY e POSTGRES_PASSWORD antes de continuar.
docker compose -f docker.yml config --quiet
docker compose -f docker.yml pull
docker compose -f docker.yml up -d
docker compose -f docker.yml ps
docker compose -f docker.yml logs --tail=50 evolution-api
```

A Evolution fica em **http://localhost:8080**. PostgreSQL e Redis são criados como serviços do Compose e ficam **dentro do Docker**.

**Não altere `POSTGRES_PASSWORD` depois que o volume do PostgreSQL foi inicializado**, pois alterar só o `.env` não troca a senha existente. Não use `docker compose down -v` para tentar corrigir erros: o `-v` remove volumes e dados.

### 7. Conectar o WhatsApp no CRM

Com o backend e a Evolution em execução:

1. Crie/conecte uma instância na Evolution, usando a API Key definida no `.env` da Evolution.
2. No Whats-Guru, abra **Integrações** e cadastre/vincule a instância.
3. Informe **URL da Evolution** `http://127.0.0.1:8080`, **nome exato da instância** e **API Key da Evolution**.
4. Confira o webhook do Whats-Guru (`http://host.docker.internal:4000`, configurado no `server/.env`) e teste recebimento e envio.
5. Para outros números, conecte outras instâncias e configure os acessos em **Equipe & Permissões**.

---

## 🧰 Comandos úteis

| Onde | Comando | Resultado |
|---|---|---|
| `server` | `npm run db:check` | Confere o banco e as 24 tabelas |
| `server` | `npx prisma generate` | Regenera o Prisma Client |
| `server` | `npm run dev` | API na porta 4000 |
| Raiz do Whats-Guru | `npm run dev` | Site na porta 5173 |
| `evolution-api` | `docker compose -f docker.yml ps` | Estado dos contêineres |
| `evolution-api` | `docker compose -f docker.yml logs --tail=50 evolution-api` | Logs da Evolution |
| `evolution-api` | `docker compose -f docker.yml stop` | Para os contêineres sem apagar dados |
| `evolution-api` | `docker compose -f docker.yml start` | Reinicia os contêineres existentes |

### Problemas mais comuns

| Erro | Causa / correção |
|---|---|
| `Database converso_local does not exist` | Criar banco vazio na etapa 2 e conferir `DATABASE_URL`. |
| `Prisma P1000` no Whats-Guru | Senha/usuário do **MySQL** incorretos. |
| `Prisma P1000` na Evolution | `POSTGRES_USER` deve ser `evolution` e a URI usa `evolution:${POSTGRES_PASSWORD}`; conferir se o volume já foi inicializado com outra senha. |
| `No such image` | Executar `docker compose -f docker.yml pull` e depois `up -d`. |
| Docker ignora o Compose | Usar `-f docker.yml`, pois esse nome não é um padrão detectado automaticamente. |
| API não recebe respostas | Verificar `HOST=0.0.0.0`, `EVOLUTION_WEBHOOK_PUBLIC_URL`, chave de webhook e firewall local. |
| `npm run dev` reiniciando por mudanças em `node_modules` | Conferir dependências/watch do Node; isso é independente da autenticação do MySQL. |

## 🔒 Segurança

Não publique os arquivos `.env`, senhas, tokens, backups ou chaves. O README usa **apenas exemplos**. Esta configuração é para **desenvolvimento local**; publicar na internet requer HTTPS, gerenciamento de segredos, firewall e permissões adequadas. Para migrar dados de outra máquina, restaure um backup do MySQL e **não** execute `db push` sobre esse banco sem avaliar as diferenças.
