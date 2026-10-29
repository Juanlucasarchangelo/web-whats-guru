import { apiRequest } from '@/lib/api';
import type { OddData, TechnicalReportData } from '@/lib/technicalReportPdf';
export type DocumentKind = 'odd' | 'technical_report';
export type DocumentPayload = OddData | TechnicalReportData;
export type DocumentSummary = {
  id: string; doc_type: DocumentKind; document_number: number; document_date: string;
  client_name: string; reference_number: string | null; creator_name: string;
  creator_kind: 'authenticated' | 'public'; created_at: string;
};
export type DocumentDetail = DocumentSummary & { payload: DocumentPayload };
export type DocumentList = { data: DocumentSummary[]; total: number; page: number; limit: number };
export function formatDocumentNumber(number: number) { return String(number).padStart(3, '0'); }
// Autoria nunca é enviada: a API autentica o JWT ou registra o autor como público.
// Chave de idempotência evita criar registros duplicados em caso de retry da rede.
export function newDocumentRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function saveTechnicalDocument(doc_type: DocumentKind, payload: DocumentPayload, client_request_id: string, publicForm = false) {
  const body = JSON.stringify({ doc_type, payload, client_request_id });
  // Formulários públicos aceitam token opcional: o servidor atribui autoria
  // somente quando ele for válido e pertencer à empresa vinculada ao link.
  // Formulários internos usam rota autenticada e permissões próprias.
  return apiRequest<{ id: string; document_number: number; doc_type: DocumentKind }>(
    publicForm ? '/public/technical-documents' : '/technical-documents',
    { method: 'POST', body });
}
export function cleanTechnicalFilename(value: string) {
  return value.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 75) || 'Cliente';
}
export function technicalDateFilename(value: string) {
  const [y,m,d] = value.split('-'); return y && m && d ? `${d}-${m}-${y}` : value;
}
