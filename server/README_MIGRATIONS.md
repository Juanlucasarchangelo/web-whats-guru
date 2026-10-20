# FalaComigo - Prisma Migrate (MySQL)

## O que contem este ZIP
- `prisma/schema.prisma`: copia do schema fornecido na conversa, com cabecalho antigo corrigido. **Nao sobrescrever um schema local mais novo sem comparar!**
- `scripts/migrations/01-preparar-baseline.ps1`: gera migration inicial SQL diretamente do banco MySQL atual, sem executa-la.
- `scripts/migrations/02-registrar-baseline.ps1`: registra baseline com `migrate resolve --applied` (nao roda DDL).
- `scripts/migrations/03-verificar-drift.ps1`: compara declaracao Prisma com o MySQL.

## Por que nao ha SQL inicial fixo neste ZIP?
O `schema.prisma` enviado tem 24 modelos, mas nao descreve relacionamentos `@relation` que ja existiam no SQL historico da aplicacao. A estrutura do seu banco tambem mudou com comandos manuais (multi-WhatsApp, indices etc). Sem acessar esse MySQL, um SQL gerado por suposicao pode ser incompleto ou perigoso. O script 01 gera o SQL do **banco real** incluindo indices e chaves estrangeiras.

## Preparacao (uma vez, PC onde MySQL ja funciona)
1. Backup do MySQL, preservando estrutura e dados; guarde fora do projeto.
2. Crie uma branch Git e confira `git status`.
3. Extraia o ZIP na raiz do projeto para criar a pasta `server/...`.
4. Compare `server/prisma/schema.prisma` empacotado com o seu atual; mantenha sempre o mais atualizado. Nao sobrescreva alteracoes recentes inadvertidamente.
5. `cd server`; `npm install`; configure `server/.env` com a `DATABASE_URL` existente.
6. `.\scripts\migrations\01-preparar-baseline.ps1`
7. Revise `prisma/migrations/20261020_baseline_mysql_atual/migration.sql` e `prisma/migrations/REVISAO_SCHEMA_VS_MYSQL.sql`.
8. **IMPORTANTE:** se REVISAO contiver `ALTER`, `DROP`, `CREATE` ou outros comandos estruturais, nao registre a baseline. Ajuste o schema Prisma para espelhar banco (relacoes/FKs, indices, defaults), revise com calma e rode a verificacao novamente.
9. Com o schema alinhado, backup feito e SQL revisado, rode `.\scripts\migrations\02-registrar-baseline.ps1`. O comando marca como aplicada e cria a tabela de controle `_prisma_migrations`.
10. Versione **o diretorio `prisma/migrations` e o `schema.prisma`** no Git. Nao versione `.env`.

### Instalacao em um MySQL NOVO, vazio
Depois que a baseline estiver revisada/registrada e commitada no Git: criar banco MySQL vazio + configurar DATABASE_URL; executar `npx prisma migrate deploy` seguido de `npx prisma generate`. **Nunca execute o script 02 em banco novo.**

### Mudancas futuras, como no Laravel
1. Edite somente `schema.prisma` em branch de desenvolvimento.
2. `npx prisma migrate dev --name descricao_da_mudanca` (em banco de desenvolvimento, apos baseline).
3. Revise a migration SQL; teste; commit do schema + pasta migration.
4. Em outro ambiente: `npx prisma migrate deploy` e `npx prisma generate`.
5. Nunca edite migrations ja aplicadas; crie uma nova migration corretiva. Evite `db push` e SQL avulso.

### Sobre reset-data.sql
Nao faz parte das migrations; nao executar para implantar ou atualizar. O ZIP nao altera ou apaga este arquivo existente.

### Limites do material
Este ZIP NAO acessou seu MySQL e NAO foi aplicado/validado contra ele. Inclui estrutura e automacao segura para preparar o historico real. **Uma migration baseline gerada do banco nao garante que o schema Prisma esteja alinhado; a revisao e obrigatoria antes do registro.**
