/** Backfill contact tags from existing conversation tags without deleting any data. */
import 'dotenv/config';
import { prisma } from '../src/db.js';
const apply = process.argv.includes('--apply');
try {
  const db = new URL(process.env.DATABASE_URL || 'mysql://localhost/').pathname.replace(/^\//,'');
  console.log(`Banco: ${db || '(não informado)'}`);
  const rows = await prisma.conversationTag.findMany();
  const ids = [...new Set(rows.map(r=>r.conversation_id))];
  const convs = await prisma.conversation.findMany({where:{id:{in:ids}},select:{id:true,contact_id:true,org_id:true}});
  const byId = new Map(convs.map(c=>[c.id,c]));
  const pairs = [...new Set(rows.filter(r=>byId.has(r.conversation_id)).map(r=>`${byId.get(r.conversation_id).contact_id}:${r.tag_id}`))];
  console.log(`${rows.length} associações nas conversas; ${pairs.length} associações únicas de contato.`);
  if (!apply) console.log('Prévia apenas. Para gravar: node scripts/sync-tags-kanban.js --apply');
  else {
    let done=0;
    for(const pair of pairs){const [contact_id,tag_id]=pair.split(':');
      const contact=await prisma.contact.findUnique({where:{id:contact_id},select:{org_id:true}});
      const tag=await prisma.tag.findUnique({where:{id:tag_id},select:{org_id:true}});
      if(!contact||!tag||contact.org_id!==tag.org_id)continue;
      await prisma.$transaction(async tx => {
        await tx.contactTag.upsert({where:{contact_id_tag_id:{contact_id,tag_id}},create:{contact_id,tag_id},update:{}});
        const convs=await tx.conversation.findMany({where:{org_id:contact.org_id,contact_id},select:{id:true}});
        for(const conv of convs)await tx.conversationTag.upsert({where:{conversation_id_tag_id:{conversation_id:conv.id,tag_id}},create:{conversation_id:conv.id,tag_id},update:{}});
      });done++;
    }
    console.log(`Sincronizadas ${done} associações no Kanban (sem excluir mensagens).`);
  }
}finally{await prisma.$disconnect();}
