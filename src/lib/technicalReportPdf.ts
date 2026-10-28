import { importsBrLogoJpegDataUrl } from './importsbrLogoData';
/** PDFs gerados 100% no navegador, sem rede, banco, NAS ou dependência externa.
 *  Texto selecionável em WinAnsi (português); imagens JPEG preservadas como imagens PDF.
 */
export type ReportStatus = 'concluido' | 'parcial' | 'pendente' | '';
export type ReportPhoto = { dataUrl: string; name: string; width: number; height: number };
export type TechnicalReportData = {
  cliente: string; data: string; operacao: string; endereco: string;
  tecnicos: string[]; status: ReportStatus; servico: string;
  pendencias: string[]; observacoes: string; fotos: ReportPhoto[];
};

const PW = 595.28; const PH = 841.89;
const C = { black: [35, 31, 32], slate: [74, 68, 66], muted: [128, 122, 114], yellow: [255, 203, 3], line: [218, 214, 207], green: [46, 125, 79], red: [180, 71, 42] } as const;
type RGB = readonly [number, number, number];
const rgb = (c: RGB) => c.map(n => (n / 255).toFixed(4)).join(' ');
function asciiPdf(value: string) {
  const substitutes: Record<string, string> = { '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '•': '-', '…': '...', '\u202f': ' ', '\u00a0': ' ' };
  return Array.from(value).map(char => substitutes[char] ?? (char.charCodeAt(0) <= 255 ? char : '?')).join('')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]/g, ' ');
}
function asBytes(raw: string) { const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff; return bytes; }
function joinBytes(parts: Uint8Array[]) { const n = parts.reduce((s, b) => s + b.length, 0); const out = new Uint8Array(n); let offset = 0; parts.forEach(b => { out.set(b, offset); offset += b.length; }); return out; }
function jpegData(dataUrl: string): Uint8Array {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Formato da foto inválido para o PDF.');
  const binary = atob(match[1]); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type Page = { ops: string[]; images: { key: string; data: Uint8Array; w: number; h: number }[] };
class PdfDocument {
  pages: Page[] = []; page: Page;
  constructor(private footerTitle = 'ImportsBR - Relatorio de Visita Tecnica') { this.page = this.addPage(); }
  addPage() { const page: Page = { ops: [], images: [] }; this.pages.push(page); this.page = page; return page; }
  rect(x: number, y: number, w: number, h: number, color: RGB) { this.page.ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${(PH - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  border(x: number, y: number, w: number, h: number, color: RGB = C.line) { this.page.ops.push(`${rgb(color)} RG .7 w ${x.toFixed(2)} ${(PH - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`); }
  line(x1: number, y1: number, x2: number, y2: number, color: RGB = C.line, weight = 0.9) { this.page.ops.push(`${rgb(color)} RG ${weight} w ${x1.toFixed(2)} ${(PH - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PH - y2).toFixed(2)} l S`); }
  text(x: number, y: number, text: string, size = 11, bold = false, color: RGB = C.black) {
    this.page.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size.toFixed(1)} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${(PH - y).toFixed(2)} Tm (${asciiPdf(text)}) Tj ET`);
  }
  // Aprox. real da Helvetica/Helvetica-Bold; também considera palavras longas.
  wrap(text: string, maxWidth: number, size = 11) {
    const max = Math.max(8, Math.floor(maxWidth / (size * 0.51)));
    const rows: string[] = [];
    for (const paragraph of String(text).replace(/\r/g, '').split('\n')) {
      if (!paragraph.trim()) { rows.push(''); continue; }
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        if (word.length > max) {
          if (line) { rows.push(line); line = ''; }
          for (let k = 0; k < word.length; k += max) rows.push(word.slice(k, k + max));
          continue;
        }
        if (line && (line + ' ' + word).length > max) { rows.push(line); line = word; } else line = line ? `${line} ${word}` : word;
      }
      if (line) rows.push(line);
    }
    return rows;
  }
  paragraph(x: number, y: number, text: string, width = 500, size = 11, leading = 17, color: RGB = C.black) {
    for (const line of this.wrap(text, width, size)) { this.text(x, y, line, size, false, color); y += leading; }
    return y;
  }
  picture(dataUrl: string, w: number, h: number, x: number, y: number, availW: number, availH: number) {
    const image = jpegData(dataUrl); const ratio = Math.min(availW / w, availH / h);
    const targetW = w * ratio; const targetH = h * ratio;
    const key = `Im${this.page.images.length + 1}`;
    this.page.images.push({ key, data: image, w, h });
    const px = x + (availW - targetW) / 2, py = y + (availH - targetH) / 2;
    this.page.ops.push(`q ${targetW.toFixed(2)} 0 0 ${targetH.toFixed(2)} ${px.toFixed(2)} ${(PH - py - targetH).toFixed(2)} cm /${key} Do Q`);
  }
  finish(): Blob {
    const entries: (Uint8Array | null)[] = [null];
    const put = (data: Uint8Array) => { entries.push(data); return entries.length - 1; };
    const obj = (s: string) => put(asBytes(s));
    const stream = (contents: Uint8Array, extra = '') => put(joinBytes([asBytes(`<< /Length ${contents.length} ${extra} >>\nstream\n`), contents, asBytes('\nendstream')]));
    const root = obj(''); const pagesRoot = obj(''); const f1 = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const refs: number[] = [];
    this.pages.forEach((page, index) => {
      const imageRefs: string[] = [];
      page.images.forEach(image => {
        const id = stream(image.data, `/Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`);
        imageRefs.push(`/${image.key} ${id} 0 R`);
      });
      // Rodapé só é inserido depois da paginação.
      const footer = [`BT /F1 8 Tf ${rgb(C.muted)} rg 1 0 0 1 40 24 Tm (${asciiPdf(this.footerTitle)}) Tj ET`,
      `BT /F1 8 Tf ${rgb(C.muted)} rg 1 0 0 1 523 24 Tm (${index + 1}/${this.pages.length}) Tj ET`];
      const commands = asBytes([...page.ops, ...footer].join('\n') + '\n');
      const content = stream(commands);
      const imageDict = imageRefs.length ? `/XObject << ${imageRefs.join(' ')} >>` : '';
      const pageRef = obj(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> ${imageDict} >> /Contents ${content} 0 R >>`);
      refs.push(pageRef);
    });
    entries[pagesRoot] = asBytes(`<< /Type /Pages /Kids [${refs.map(id => id + ' 0 R').join(' ')}] /Count ${refs.length} >>`);
    entries[root] = asBytes(`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`);
    const chunks = [asBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; const offsets = [0]; let cursor = chunks[0].length;
    for (let id = 1; id < entries.length; id++) {
      offsets[id] = cursor;
      const body = joinBytes([asBytes(`${id} 0 obj\n`), entries[id]!, asBytes('\nendobj\n')]);
      chunks.push(body); cursor += body.length;
    }
    const xrefPos = cursor;
    let xref = `xref\n0 ${entries.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < entries.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${entries.length} /Root ${root} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    chunks.push(asBytes(xref));
    return new Blob([joinBytes(chunks) as BlobPart], { type: 'application/pdf' });
  }
}
function fmtDate(value: string) { const [year, month, day] = value.split('-'); return year && month && day ? `${day}/${month}/${year}` : value; }
function header(pdf: PdfDocument, subtitle: string) {
  pdf.picture(importsBrLogoJpegDataUrl, 1024, 289, 40, 30, 135, 38);
  pdf.text(435, 53, 'TÉCNICO  ·  ONLINE', 9, false, C.slate);
  pdf.rect(40, 85, 515, 2.5, C.yellow);
  pdf.text(40, 111, 'VISITA TÉCNICA', 10, false, C.red);
  pdf.text(40, 140, subtitle, 21, true);
  pdf.line(40, 156, 555, 156, C.black, 1.2);
}
function section(pdf: PdfDocument, n: number, title: string, y: number) {
  pdf.rect(40, y - 11, 17, 17, C.yellow);
  pdf.text(45, y + 1, String(n), 10, true, C.black);
  pdf.text(67, y + 1, title.toUpperCase(), 10, false, C.slate);
  return y + 27;
}
function field(pdf: PdfDocument, label: string, value: string, y: number) {
  pdf.text(40, y, label, 10, true); const next = pdf.paragraph(40, y + 19, value || '—', 500, 11, 17);
  pdf.line(40, next + 1, 555, next + 1, C.line);
  return next + 25;
}
function newPage(pdf: PdfDocument, title: string) { pdf.addPage(); header(pdf, title); return 181; }
function remaining(y: number, height: number) { return y + height < 805; }

export function generateTechnicalPdf(data: TechnicalReportData, includePendencias = false): Blob {
  const pdf = new PdfDocument(); header(pdf, 'Relatório de Obra'); let y = 184;
  y = section(pdf, 1, 'Identificação', y);
  y = field(pdf, 'Cliente', data.cliente, y);
  pdf.text(40, y, 'Data', 10, true); pdf.text(305, y, 'Operação', 10, true);
  pdf.text(40, y + 20, fmtDate(data.data), 11); pdf.text(305, y + 20, data.operacao || '—', 11);
  pdf.line(40, y + 26, 291, y + 26); pdf.line(305, y + 26, 555, y + 26); y += 51;
  y = field(pdf, 'Endereço', data.endereco, y);
  y = section(pdf, 2, 'Técnicos em campo', y);
  y = field(pdf, 'Equipe', data.tecnicos.filter(Boolean).join(', '), y);
  y = section(pdf, 3, 'Serviço executado', y);
  pdf.text(40, y, 'Status do serviço', 10, true);
  const keys = ['concluido', 'parcial', 'pendente']; const labels = ['CONCLUÍDO', 'PARCIAL', 'PENDENTE'];
  for (let i = 0; i < 3; i++) {
    const active = keys[i] === data.status; const x = 40 + i * 174;
    pdf.rect(x, y + 10, 165, 26, active ? (i === 0 ? C.green : i === 1 ? C.yellow : C.red) : [249, 248, 246]);
    pdf.text(x + 37, y + 27, labels[i], 9, true, active && i !== 1 ? ([255, 255, 255] as const) : C.slate);
  }
  y += 59;
  pdf.text(40, y, 'Descrição do serviço realizado', 10, true); y += 22;
  for (const line of pdf.wrap(data.servico, 500, 11)) {
    if (!remaining(y, 19)) { y = newPage(pdf, 'Relatório de Obra — Continuação'); }
    pdf.text(40, y, line, 11); y += 17;
  }
  y += 25;
  // Observações vêm no final do documento (após as fotografias), como no modelo.
  if (data.fotos.length) {
    for (let i = 0; i < data.fotos.length; i++) {
      y = newPage(pdf, 'Registro Fotográfico');
      y = section(pdf, 4, 'Registro fotográfico', y);
      pdf.text(40, y, `Fotografia ${i + 1} de ${data.fotos.length}`, 10, false, C.slate); y += 20;
      const isLast = i === data.fotos.length - 1;
      const photoH = isLast && data.observacoes.trim() ? 440 : 520;
      pdf.border(40, y, 515, photoH);
      const photo = data.fotos[i]; pdf.picture(photo.dataUrl, photo.width, photo.height, 48, y + 8, 499, photoH - 16);
      y += photoH + 21;
      if (isLast && data.observacoes.trim()) {
        y = section(pdf, 5, 'Observações', y);
        for (const line of pdf.wrap(data.observacoes, 500, 10)) {
          if (!remaining(y, 18)) y = newPage(pdf, 'Observações');
          pdf.text(40, y, line, 10); y += 16;
        }
      }
    }
  } else {
    if (!remaining(y, 100)) y = newPage(pdf, 'Observações');
    y = section(pdf, 4, 'Observações', y);
    const lines = pdf.wrap(data.observacoes || 'Sem observações registradas.', 500, 11);
    for (const line of lines) { if (!remaining(y, 19)) y = newPage(pdf, 'Observações'); pdf.text(40, y, line, 11); y += 17; }
  }
  if (includePendencias) {
    // O relatório completo inclui tudo que existe no relatório sem pendências,
    // acrescentando as pendências em seção própria ao final do documento.
    y = newPage(pdf, 'Relatório Completo — Pendências');
    y = section(pdf, 6, 'Pendências registradas', y);
    const pending = data.pendencias.map(item => item.trim()).filter(Boolean);
    if (!pending.length) {
      pdf.text(40, y, 'Nenhuma pendência registrada nesta visita.', 11, false, C.green);
    } else {
      for (let i = 0; i < pending.length; i++) {
        const lines = pdf.wrap(pending[i], 475, 11);
        if (!remaining(y, 60)) y = newPage(pdf, 'Pendências — Continuação');
        pdf.text(40, y, `PENDÊNCIA ${String(i + 1).padStart(2, '0')}`, 10, true, C.red);
        y += 24;
        for (const line of lines) {
          if (!remaining(y, 22)) y = newPage(pdf, 'Pendências — Continuação');
          pdf.text(40, y, line, 11);
          y += 18;
        }
        if (!remaining(y, 24)) y = newPage(pdf, 'Pendências — Continuação');
        pdf.line(40, y + 3, 555, y + 3, C.line);
        y += 25;
      }
    }
  }
  return pdf.finish();
}

export function generatePendingPdf(data: TechnicalReportData): Blob {
  const pdf = new PdfDocument(); header(pdf, 'Relatório de Pendências'); let y = 184;
  y = section(pdf, 1, 'Identificação', y);
  y = field(pdf, 'Cliente', data.cliente, y);
  pdf.text(40, y, 'Data', 10, true); pdf.text(305, y, 'Operação', 10, true);
  pdf.text(40, y + 20, fmtDate(data.data), 11); pdf.text(305, y + 20, data.operacao || '—', 11);
  pdf.line(40, y + 26, 291, y + 26); pdf.line(305, y + 26, 555, y + 26); y += 51;
  y = field(pdf, 'Endereço', data.endereco, y);
  y = section(pdf, 2, 'Pendências registradas', y);
  const pending = data.pendencias.map(s => s.trim()).filter(Boolean);
  if (!pending.length) { pdf.text(40, y, 'Nenhuma pendência registrada nesta visita.', 11, false, C.green); }
  pending.forEach((text, i) => {
    const lines = pdf.wrap(text, 475, 11); const blockHeight = 30 + lines.length * 18;
    if (!remaining(y, blockHeight)) y = newPage(pdf, 'Pendências — Continuação');
    pdf.rect(40, y - 2, 3, blockHeight - 7, C.red);
    pdf.text(54, y + 13, `PENDÊNCIA ${String(i + 1).padStart(2, '0')}`, 10, true, C.red);
    let py = y + 35;
    for (const line of lines) { pdf.text(54, py, line, 11); py += 18; }
    pdf.line(54, py + 1, 555, py + 1, C.line); y = py + 23;
  });
  return pdf.finish();
}


/** Ordem do Dia (ODD) — gerada integralmente no navegador, sem armazenamento externo. */
export type OddTechnician = { nome: string; funcao: string };
export type OddData = {
  coordenador: string;
  data: string;
  cliente: string;
  endereco: string;
  tecnicos: OddTechnician[];
  objetivos: string[];
  observacoes: string;
};

const ODD_END = 784;
function oddHeader(pdf: PdfDocument, continuation = false) {
  // Cabeçalho de duas colunas, inspirado no modelo ODD enviado pela ImportsBR.
  pdf.picture(importsBrLogoJpegDataUrl, 1024, 289, 40, 29, 135, 38);
  pdf.text(408, 54, continuation ? 'Ordem do Dia' : 'Ordem do Dia', 19, true);
  pdf.text(417, 70, 'VISITA TECNICA DE OBRA', 8, false, C.slate);
  pdf.line(40, 89, 555, 89, C.black, 1.5);
}
function oddPage(pdf: PdfDocument) { pdf.addPage(); oddHeader(pdf, true); return 120; }
function oddEnsure(pdf: PdfDocument, y: number, required: number) {
  return y + required > ODD_END ? oddPage(pdf) : y;
}
function oddSection(pdf: PdfDocument, title: string, count: number | undefined, y: number) {
  y = oddEnsure(pdf, y, 49);
  pdf.rect(40, y - 10, 7, 7, C.yellow);
  pdf.text(56, y - 2, title.toUpperCase(), 10, true, C.black);
  if (count !== undefined) pdf.text(530, y - 2, String(count).padStart(2, '0'), 9, false, C.slate);
  return y + 24;
}
function oddField(pdf: PdfDocument, x: number, y: number, label: string, value: string, width: number) {
  pdf.text(x, y, label.toUpperCase(), 8, false, C.slate);
  const lines = pdf.wrap(value.trim() || '-', width - 7, 11);
  let ty = y + 23;
  for (const ln of lines) { pdf.text(x, ty, ln, 11); ty += 17; }
  pdf.line(x, ty + 2, x + width, ty + 2, C.line, 0.9);
  return ty + 19;
}
export function generateOddPdf(data: OddData): Blob {
  const pdf = new PdfDocument('ImportsBR - Ordem do Dia');
  oddHeader(pdf);
  let y = 125;
  y = oddSection(pdf, 'Dados gerais', undefined, y);
  const left = oddField(pdf, 40, y, 'Coordenador técnico', data.coordenador, 242);
  const right = oddField(pdf, 305, y, 'Data', fmtDate(data.data), 250);
  y = Math.max(left, right) + 9;
  const clientY = oddField(pdf, 40, y, 'Cliente', data.cliente, 242);
  const placeY = oddField(pdf, 305, y, 'Endereço da obra', data.endereco, 250);
  y = Math.max(clientY, placeY) + 19;
  const technicians = data.tecnicos.filter(t => t.nome.trim() || t.funcao.trim());
  y = oddSection(pdf, 'Técnicos em visita', technicians.length, y);
  for (let i = 0; i < technicians.length; i++) {
    const tech = technicians[i];
    const nameLines = pdf.wrap(tech.nome || '-', 480, 11);
    const roleLines = pdf.wrap(tech.funcao || '-', 480, 11);
    const boxHeight = 105 + (nameLines.length + roleLines.length - 2) * 17;
    y = oddEnsure(pdf, y, boxHeight + 16);
    pdf.border(40, y, 515, boxHeight, C.line);
    pdf.text(53, y + 18, `TÉCNICO ${String(i + 1).padStart(2, '0')}`, 8, true, C.slate);
    pdf.text(53, y + 37, 'NOME', 8, false, C.muted);
    let yy = y + 54;
    for (const ln of nameLines) { pdf.text(53, yy, ln, 11); yy += 17; }
    pdf.line(53, yy - 11, 542, yy - 11, C.line, 0.6);
    pdf.text(53, yy + 2, 'ESPECIALIDADE / FUNÇÃO', 8, false, C.muted);
    yy += 19;
    for (const ln of roleLines) { pdf.text(53, yy, ln, 11); yy += 17; }
    y += boxHeight + 12;
  }
  if (!technicians.length) { y = oddEnsure(pdf, y, 35); pdf.text(40, y + 8, 'Nenhum técnico informado.', 10, false, C.muted); y += 43; }
  y += 19;
  const objectives = data.objetivos.map(s => s.trim()).filter(Boolean);
  y = oddSection(pdf, 'Objetivo do dia', objectives.length, y);
  for (let i = 0; i < objectives.length; i++) {
    const lines = pdf.wrap(objectives[i], 445, 11);
    const boxHeight = Math.max(51, 30 + lines.length * 17);
    y = oddEnsure(pdf, y, boxHeight + 12);
    pdf.border(40, y, 515, boxHeight, C.line);
    pdf.text(54, y + 23, String(i + 1).padStart(2, '0'), 10, true, C.slate);
    let yy = y + 23;
    for (const ln of lines) { pdf.text(79, yy, ln, 11); yy += 17; }
    y += boxHeight + 11;
  }
  if (!objectives.length) { y = oddEnsure(pdf, y, 35); pdf.text(40, y + 8, 'Nenhum objetivo informado.', 10, false, C.muted); y += 40; }
  y += 18;
  const observations = data.observacoes.trim() || 'Sem observações gerais.';
  const obsLines = pdf.wrap(observations, 480, 11);
  const obsHeight = Math.max(60, 34 + obsLines.length * 18);
  y = oddEnsure(pdf, y, obsHeight + 36);
  pdf.text(40, y, 'OBSERVAÇÕES GERAIS', 9, false, C.slate);
  pdf.border(40, y + 13, 515, obsHeight, C.slate);
  let oy = y + 37;
  for (const ln of obsLines) { pdf.text(53, oy, ln, 11); oy += 18; }
  return pdf.finish();
}
