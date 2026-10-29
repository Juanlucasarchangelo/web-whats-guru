import { z } from 'zod';

const string = (max = 120) => z.string().trim().max(max);
const required = (max = 120) => string(max).min(1);
const validDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Data inválida');
const photo = z.object({
  dataUrl: z.string().startsWith('data:image/jpeg;base64,').max(12_000_000),
  name: string(255), width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
}).strict();
const oddSchema = z.object({
  coordenador: required(), data: validDate, cliente: required(), endereco: required(500),
  numeroProposta: string().optional().default(''),
  tecnicos: z.array(z.object({ nome: string(), funcao: string() }).strict()).max(100),
  objetivos: z.array(string(2000)).max(150), observacoes: string(10000),
}).strict();
const reportSchema = z.object({
  cliente: required(), data: validDate, operacao: string(), endereco: string(500),
  numeroOdd: string().optional().default(''),
  tecnicos: z.array(string()).max(100),
  status: z.enum(['concluido','parcial','pendente','']),
  servico: required(10000), pendencias: z.array(string(10000)).max(100),
  observacoes: string(10000), fotos: z.array(photo).max(10),
}).strict();
const requestSchema = z.discriminatedUnion('doc_type', [
  z.object({ doc_type: z.literal('odd'), payload: oddSchema, client_request_id: z.string().uuid() }).strict(),
  z.object({ doc_type: z.literal('technical_report'), payload: reportSchema, client_request_id: z.string().uuid() }).strict(),
]);

export const technicalDocumentSchemas = { oddSchema, reportSchema, requestSchema };
