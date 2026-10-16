import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError, toastWarning } from '@/components/ui/Toast';
import type { Chatbot, FlowNode, FlowEdge } from '@/types';
import {
  Bot, Plus, Pencil, Trash2, Play, Pause, MessageSquare,
  HelpCircle, GitBranch, Clock, Tag, UserCheck, Webhook,
  Power, ArrowRight, Save, X,
} from 'lucide-react';

const NODE_TYPES = [
  { type: 'message', label: 'Mensagem', icon: MessageSquare, color: 'bg-blue-100 text-blue-700 ring-blue-200' },
  { type: 'question', label: 'Pergunta', icon: HelpCircle, color: 'bg-yellow-100 text-yellow-700 ring-yellow-200' },
  { type: 'condition', label: 'Condição', icon: GitBranch, color: 'bg-purple-100 text-purple-700 ring-purple-200' },
  { type: 'delay', label: 'Atraso', icon: Clock, color: 'bg-orange-100 text-orange-700 ring-orange-200' },
  { type: 'tag', label: 'Etiqueta', icon: Tag, color: 'bg-green-100 text-green-700 ring-green-200' },
  { type: 'assign', label: 'Atribuição', icon: UserCheck, color: 'bg-indigo-100 text-indigo-700 ring-indigo-200' },
  { type: 'webhook', label: 'Webhook', icon: Webhook, color: 'bg-pink-100 text-pink-700 ring-pink-200' },
  { type: 'close', label: 'Encerramento', icon: Power, color: 'bg-red-100 text-red-700 ring-red-200' },
] as const;

export function ChatbotsPage() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<Chatbot | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Chatbot | null>(null);
  const [saving, setSaving] = useState(false);

  // Builder state
  const [botName, setBotName] = useState('');
  const [botDesc, setBotDesc] = useState('');
  const [botKeyword, setBotKeyword] = useState('');
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [nodeText, setNodeText] = useState('');
  const [nodeOptions, setNodeOptions] = useState('');
  const [nodeField, setNodeField] = useState('');
  const [nodeOperator, setNodeOperator] = useState('equals');
  const [nodeValue, setNodeValue] = useState('');
  const [nodeTag, setNodeTag] = useState('');
  const [nodeTeam, setNodeTeam] = useState('');
  const [nodeUrl, setNodeUrl] = useState('');
  const [nodeDelay, setNodeDelay] = useState('5');
  const [nodeDelayUnit, setNodeDelayUnit] = useState('minutes');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('chatbots')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setChatbots((data ?? []) as Chatbot[]);
    } catch {
      toastError('Erro ao carregar chatbots');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function openBuilder(bot: Chatbot | null) {
    setEditing(bot);
    if (bot) {
      setBotName(bot.name);
      setBotDesc(bot.description ?? '');
      setBotKeyword(bot.trigger_keyword ?? '');
      setNodes(bot.flow.nodes ?? []);
      setEdges(bot.flow.edges ?? []);
    } else {
      setBotName('');
      setBotDesc('');
      setBotKeyword('');
      setNodes([
        {
          id: 'start',
          type: 'start',
          data: { text: 'Início do fluxo' },
          position: { x: 300, y: 40 },
        },
      ]);
      setEdges([]);
    }
    setSelectedNode(null);
    setShowBuilder(true);
  }

  function addNode(type: FlowNode['type']) {
    const id = `node_${Date.now()}`;
    const yPos = nodes.length * 130 + 40;
    const newNode: FlowNode = {
      id,
      type,
      data: getDefaultNodeData(type),
      position: { x: 300, y: yPos },
    };
    setNodes(prev => [...prev, newNode]);
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      setEdges(prev => [...prev, { from: lastNode.id, to: id }]);
    }
    setSelectedNode(newNode);
    selectNode(newNode);
  }

  function getDefaultNodeData(type: FlowNode['type']): FlowNode['data'] {
    switch (type) {
      case 'message': return { text: 'Nova mensagem' };
      case 'question': return { text: 'Nova pergunta', options: ['Opção 1', 'Opção 2'] };
      case 'condition': return { field: 'resposta', operator: 'equals', value: '' };
      case 'delay': return { delay: 5, delayUnit: 'minutes' };
      case 'tag': return { tag: 'Nova etiqueta' };
      case 'assign': return { team: 'Suporte' };
      case 'webhook': return { url: 'https://exemplo.com/webhook' };
      case 'close': return { text: 'Conversa encerrada' };
      default: return { text: '' };
    }
  }

  function updateSelectedNode() {
    if (!selectedNode) return;
    const updated: FlowNode = { ...selectedNode };
    switch (selectedNode.type) {
      case 'message':
      case 'close':
        updated.data = { ...updated.data, text: nodeText };
        break;
      case 'question':
        updated.data = { ...updated.data, text: nodeText, options: nodeOptions.split(',').map(o => o.trim()).filter(Boolean) };
        break;
      case 'condition':
        updated.data = { ...updated.data, field: nodeField, operator: nodeOperator, value: nodeValue };
        break;
      case 'tag':
        updated.data = { ...updated.data, tag: nodeTag };
        break;
      case 'assign':
        updated.data = { ...updated.data, team: nodeTeam };
        break;
      case 'webhook':
        updated.data = { ...updated.data, url: nodeUrl };
        break;
      case 'delay':
        updated.data = { ...updated.data, delay: parseInt(nodeDelay) || 5, delayUnit: nodeDelayUnit };
        break;
    }
    setNodes(prev => prev.map(n => n.id === selectedNode.id ? updated : n));
    setSelectedNode(updated);
  }

  function deleteNode(nodeId: string) {
    if (nodeId === 'start') return;
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.from !== nodeId && e.to !== nodeId));
    setSelectedNode(null);
  }

  function selectNode(node: FlowNode) {
    setSelectedNode(node);
    setNodeText(node.data.text ?? '');
    setNodeOptions(node.data.options?.join(', ') ?? '');
    setNodeField(node.data.field ?? '');
    setNodeOperator(node.data.operator ?? 'equals');
    setNodeValue(node.data.value ?? '');
    setNodeTag(node.data.tag ?? '');
    setNodeTeam(node.data.team ?? '');
    setNodeUrl(node.data.url ?? '');
    setNodeDelay(String(node.data.delay ?? 5));
    setNodeDelayUnit(node.data.delayUnit ?? 'minutes');
  }

  async function handleSaveBot() {
    if (!orgId || !user) {
      toastError('Sua sessão ou empresa não está disponível. Faça login novamente.');
      return;
    }
    if (!botName.trim()) {
      toastWarning('Informe um nome para o chatbot antes de salvar.');
      return;
    }

    if (nodes.length < 2 || edges.length < 1) {
      toastWarning('Adicione pelo menos uma mensagem ao fluxo antes de salvar.');
      return;
    }
    setSaving(true);
    try {
      const flow = { nodes, edges };
      if (editing) {
        const { error } = await supabase
          .from('chatbots')
          .update({
            name: botName.trim(),
            description: botDesc.trim() || null,
            trigger_channel: 'whatsapp',
            trigger_keyword: botKeyword.trim() || null,
            flow,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editing.id)
          .eq('org_id', orgId);
        if (error) throw error;
        toastSuccess('Chatbot atualizado');
      } else {
        const { error } = await supabase.from('chatbots').insert({
          org_id: orgId,
          name: botName.trim(),
          description: botDesc.trim() || null,
          trigger_channel: 'whatsapp',
          trigger_keyword: botKeyword.trim() || null,
          flow,
          created_by: user.id,
        });
        if (error) throw error;
        toastSuccess('Chatbot criado');
      }
      setShowBuilder(false);
      await load();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Erro ao salvar chatbot');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(bot: Chatbot) {
    if (bot.status !== 'active' && (!bot.flow?.nodes?.length || !bot.flow?.edges?.length)) {
      toastWarning('Configure e salve o fluxo antes de ativar o chatbot.'); return;
    }
    const newStatus = bot.status === 'active' ? 'paused' : 'active';
    try {
      const { error } = await supabase
        .from('chatbots')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', bot.id);
      if (error) throw error;
      toastSuccess(newStatus === 'active' ? 'Chatbot ativado' : 'Chatbot pausado');
      load();
    } catch {
      toastError('Erro ao alterar status');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('chatbots').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toastSuccess('Chatbot excluído');
      setShowConfirmDelete(false);
      setDeleteTarget(null);
      load();
    } catch {
      toastError('Erro ao excluir chatbot');
    }
  }

  const nodeIcon = (type: string) => {
    const nt = NODE_TYPES.find(n => n.type === type);
    return nt ? nt.icon : MessageSquare;
  };
  const nodeColor = (type: string) => {
    const nt = NODE_TYPES.find(n => n.type === type);
    return nt ? nt.color : 'bg-slate-100 text-slate-700 ring-slate-200';
  };
  const nodeLabel = (type: string) => {
    const nt = NODE_TYPES.find(n => n.type === type);
    return nt ? nt.label : type;
  };

  if (showBuilder) {
    return (
      <div className="flex h-full flex-col">
        {/* Builder header */}
        <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button onClick={() => setShowBuilder(false)} className="btn-ghost px-2">
              <X size={20} />
            </button>
            <input
              type="text"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className="input max-w-xs py-1.5"
              placeholder="Nome do chatbot"
            />
          </div>
          <button onClick={handleSaveBot} disabled={saving} className="btn-primary">
            {saving ? <Spinner size={16} /> : <Save size={16} />}
            Salvar
          </button>
        </div>

        <div className="bg-blue-50 border-b border-blue-100 px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Palavra-chave para iniciar (opcional)</label>
            <input className="input mt-1" value={botKeyword} onChange={e => setBotKeyword(e.target.value)} placeholder="Ex.: menu, orçamento, suporte" />
            <p className="text-xs text-slate-500 mt-1">Vazio = inicia apenas no primeiro contato. Preenchido = também inicia quando a palavra aparecer.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Descrição (opcional)</label>
            <input className="input mt-1" value={botDesc} onChange={e => setBotDesc(e.target.value)} placeholder="Objetivo do fluxo" />
            <p className="text-xs text-slate-500 mt-1">Clique em Aplicar alterações em cada nó, Salvar e depois Ativar. Digitar atendente encerra uma pergunta.</p>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Node palette */}
          <div className="w-56 border-r border-slate-200 bg-white p-3 overflow-y-auto">
            <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Adicionar nó</h3>
            <div className="space-y-1.5">
              {NODE_TYPES.map(nt => {
                const Icon = nt.icon;
                return (
                  <button
                    key={nt.type}
                    onClick={() => addNode(nt.type)}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-slate-50 text-left text-sm text-slate-700 transition-colors"
                  >
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${nt.color}`}>
                      <Icon size={14} />
                    </div>
                    {nt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-auto bg-slate-50 relative" style={{
            backgroundImage: 'radial-gradient(circle, rgb(var(--ui-slate-300)) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}>
            <div className="relative" style={{ minWidth: '800px', minHeight: '600px' }}>
              {/* Edges */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                {edges.map((edge, i) => {
                  const from = nodes.find(n => n.id === edge.from);
                  const to = nodes.find(n => n.id === edge.to);
                  if (!from || !to) return null;
                  const x1 = from.position.x + 130;
                  const y1 = from.position.y + 30;
                  const x2 = to.position.x + 130;
                  const y2 = to.position.y + 30;
                  const midY = (y1 + y2) / 2;
                  return (
                    <g key={i}>
                      <path
                        d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        markerEnd="url(#arrowhead)"
                      />
                    </g>
                  );
                })}
                <defs>
                  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                  </marker>
                </defs>
              </svg>

              {/* Nodes */}
              {nodes.map(node => {
                const Icon = nodeIcon(node.type);
                const isActive = selectedNode?.id === node.id;
                return (
                  <div
                    key={node.id}
                    onClick={() => selectNode(node)}
                    className={`absolute w-60 rounded-xl bg-white shadow-md ring-1 cursor-pointer transition-all hover:shadow-lg ${
                      isActive ? 'ring-2 ring-blue-400' : 'ring-slate-200'
                    }`}
                    style={{ left: node.position.x, top: node.position.y }}
                  >
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl ring-1 ring-inset ${nodeColor(node.type)}`}>
                      <Icon size={14} />
                      <span className="text-xs font-semibold">{nodeLabel(node.type)}</span>
                      {node.id !== 'start' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}
                          className="ml-auto text-slate-400 hover:text-red-500"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-sm text-slate-700 line-clamp-2">
                        {node.data.text || node.data.value || node.data.tag || node.data.team || node.data.url || `${node.data.delay || ''} ${node.data.delayUnit || ''}`}
                      </p>
                      {node.data.options && node.data.options.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {node.data.options.slice(0, 3).map((opt, i) => (
                            <span key={i} className="badge badge-gray text-[10px]">{opt}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Node editor panel */}
          {selectedNode && selectedNode.type !== 'start' && (
            <div className="w-72 border-l border-slate-200 bg-white p-4 overflow-y-auto">
              <h3 className="font-semibold text-slate-900 mb-4">Editar nó: {nodeLabel(selectedNode.type)}</h3>
              <div className="space-y-3">
                {(selectedNode.type === 'message' || selectedNode.type === 'close') && (
                  <div>
                    <label className="label">Texto da mensagem</label>
                    <textarea
                      value={nodeText}
                      onChange={(e) => setNodeText(e.target.value)}
                      className="input resize-none"
                      rows={4}
                    />
                  </div>
                )}
                {selectedNode.type === 'question' && (
                  <>
                    <div>
                      <label className="label">Pergunta</label>
                      <textarea
                        value={nodeText}
                        onChange={(e) => setNodeText(e.target.value)}
                        className="input resize-none"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="label">Opções (separadas por vírgula)</label>
                      <input
                        type="text"
                        value={nodeOptions}
                        onChange={(e) => setNodeOptions(e.target.value)}
                        className="input"
                        placeholder="Opção 1, Opção 2, Opção 3"
                      />
                    </div>
                  </>
                )}
                {selectedNode.type === 'condition' && (
                  <>
                    <div>
                      <label className="label">Campo</label>
                      <input type="text" value={nodeField} onChange={(e) => setNodeField(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Operador</label>
                      <select value={nodeOperator} onChange={(e) => setNodeOperator(e.target.value)} className="input">
                        <option value="equals">Igual a</option>
                        <option value="contains">Contém</option>
                        <option value="not_equals">Diferente de</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Valor</label>
                      <input type="text" value={nodeValue} onChange={(e) => setNodeValue(e.target.value)} className="input" />
                    </div>
                  </>
                )}
                {selectedNode.type === 'tag' && (
                  <div>
                    <label className="label">Etiqueta</label>
                    <input type="text" value={nodeTag} onChange={(e) => setNodeTag(e.target.value)} className="input" />
                  </div>
                )}
                {selectedNode.type === 'assign' && (
                  <div>
                    <label className="label">Time</label>
                    <input type="text" value={nodeTeam} onChange={(e) => setNodeTeam(e.target.value)} className="input" />
                  </div>
                )}
                {selectedNode.type === 'webhook' && (
                  <div>
                    <label className="label">URL do Webhook</label>
                    <input type="text" value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)} className="input" />
                  </div>
                )}
                {selectedNode.type === 'delay' && (
                  <>
                    <div>
                      <label className="label">Quantidade</label>
                      <input type="number" value={nodeDelay} onChange={(e) => setNodeDelay(e.target.value)} className="input" min="1" />
                    </div>
                    <div>
                      <label className="label">Unidade</label>
                      <select value={nodeDelayUnit} onChange={(e) => setNodeDelayUnit(e.target.value)} className="input">
                        <option value="seconds">Segundos</option>
                        <option value="minutes">Minutos</option>
                        <option value="hours">Horas</option>
                        <option value="days">Dias</option>
                      </select>
                    </div>
                  </>
                )}
                <button onClick={updateSelectedNode} className="btn-primary w-full">
                  <Save size={16} /> Aplicar alterações
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Chatbots</h1>
          <p className="text-sm text-slate-500 mt-1">{chatbots.length} chatbot(s) · Fluxos executados no WhatsApp via Evolution; sem IA obrigatória.</p>
        </div>
        <button onClick={() => openBuilder(null)} className="btn-primary">
          <Plus size={18} /> Novo chatbot
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={32} /></div>
      ) : chatbots.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bot size={28} />}
            title="Nenhum chatbot"
            description="Crie um chatbot com fluxo visual para automatizar o atendimento."
            action={<button onClick={() => openBuilder(null)} className="btn-primary"><Plus size={16} /> Criar chatbot</button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {chatbots.map(bot => {
            const Icon = Bot;
            return (
              <div key={bot.id} className="card p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                      <Icon size={22} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{bot.name}</p>
                      <span className={`badge ${bot.status === 'active' ? 'badge-green' : bot.status === 'paused' ? 'badge-yellow' : 'badge-gray'}`}>
                        {bot.status === 'active' ? 'Ativo' : bot.status === 'paused' ? 'Pausado' : 'Rascunho'}
                      </span>
                    </div>
                  </div>
                </div>
                {bot.description && <p className="text-sm text-slate-500 mb-3 line-clamp-2">{bot.description}</p>}
                <div className="text-xs text-slate-400 mb-3">
                  {bot.flow.nodes?.length ?? 0} nó(s) · {bot.flow.edges?.length ?? 0} conexão(ões) · {bot.trigger_keyword ? `Início: ${bot.trigger_keyword}` : 'Início: nova conversa'}
                </div>
                <div className="flex items-center gap-2 pt-3 border-t border-slate-50">
                  <button onClick={() => openBuilder(bot)} className="btn-ghost text-xs px-2 py-1.5">
                    <Pencil size={14} /> Editar
                  </button>
                  <button onClick={() => toggleStatus(bot)} className="btn-ghost text-xs px-2 py-1.5">
                    {bot.status === 'active' ? <><Pause size={14} /> Pausar</> : <><Play size={14} /> Ativar</>}
                  </button>
                  <button
                    onClick={() => { setDeleteTarget(bot); setShowConfirmDelete(true); }}
                    className="btn-ghost text-xs px-2 py-1.5 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} /> Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={showConfirmDelete}
        title="Excluir chatbot"
        message={`Tem certeza que deseja excluir "${deleteTarget?.name}"?`}
        confirmLabel="Excluir"
        danger
        onConfirm={handleDelete}
        onCancel={() => { setShowConfirmDelete(false); setDeleteTarget(null); }}
      />
    </div>
  );
}
