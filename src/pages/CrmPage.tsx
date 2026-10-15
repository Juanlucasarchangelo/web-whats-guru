import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Contact } from '@/types';
import {
  Kanban, Plus, GripVertical, DollarSign, Mail, Phone,
} from 'lucide-react';

const STAGES = [
  { value: 'lead', label: 'Lead', color: 'border-t-blue-500', badge: 'badge-blue' },
  { value: 'qualified', label: 'Qualificado', color: 'border-t-yellow-500', badge: 'badge-yellow' },
  { value: 'negotiation', label: 'Negociação', color: 'border-t-purple-500', badge: 'badge-purple' },
  { value: 'won', label: 'Ganho', color: 'border-t-green-500', badge: 'badge-green' },
  { value: 'lost', label: 'Perdido', color: 'border-t-red-500', badge: 'badge-red' },
];

export function CrmPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setContacts((data ?? []) as Contact[]);
    } catch {
      toastError('Erro ao carregar contatos');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function handleDrop(stage: string) {
    if (!draggedId) return;
    const contact = contacts.find(c => c.id === draggedId);
    if (!contact || contact.crm_stage === stage) {
      setDraggedId(null);
      setDragOverStage(null);
      return;
    }

    setContacts(prev => prev.map(c => c.id === draggedId ? { ...c, crm_stage: stage } : c));
    setDraggedId(null);
    setDragOverStage(null);

    try {
      const { error } = await supabase
        .from('contacts')
        .update({ crm_stage: stage, updated_at: new Date().toISOString() })
        .eq('id', contact.id);
      if (error) throw error;
      toastSuccess(`${contact.name} movido para "${STAGES.find(s => s.value === stage)?.label}"`);
    } catch {
      toastError('Erro ao mover contato');
      load();
    }
  }

  const contactsByStage = (stage: string) => contacts.filter(c => c.crm_stage === stage);
  const totalValue = contacts
    .filter(c => !['lost', 'won'].includes(c.crm_stage))
    .reduce((sum, c) => sum + Number(c.crm_value), 0);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={32} /></div>;

  return (
    <div className="p-4 lg:p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">CRM Kanban</h1>
          <p className="text-sm text-slate-500 mt-1">
            {contacts.length} contato(s) · Pipeline: {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="card flex-1">
          <EmptyState
            icon={<Kanban size={28} />}
            title="Nenhum contato no CRM"
            description="Crie contatos na aba Contatos para visualizá-los no kanban."
          />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 min-w-max h-full pb-4">
            {STAGES.map(stage => {
              const stageContacts = contactsByStage(stage.value);
              const stageValue = stageContacts.reduce((sum, c) => sum + Number(c.crm_value), 0);
              return (
                <div
                  key={stage.value}
                  className={`w-72 flex-shrink-0 flex flex-col rounded-xl bg-slate-100/70 ${
                    dragOverStage === stage.value ? 'ring-2 ring-blue-400' : ''
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.value); }}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={() => handleDrop(stage.value)}
                >
                  <div className={`px-4 py-3 border-t-4 rounded-t-xl ${stage.color} bg-white`}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900 text-sm">{stage.label}</h3>
                      <span className="badge badge-gray">{stageContacts.length}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {stageValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageContacts.map(contact => (
                      <div
                        key={contact.id}
                        draggable
                        onDragStart={() => setDraggedId(contact.id)}
                        onDragEnd={() => { setDraggedId(null); setDragOverStage(null); }}
                        className={`bg-white rounded-lg p-3 shadow-sm ring-1 ring-slate-200 cursor-move hover:shadow-md transition-all ${
                          draggedId === contact.id ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <GripVertical size={14} className="text-slate-300 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{contact.name}</p>
                            {contact.is_demo && <span className="text-[10px] text-slate-400">Demo</span>}
                          </div>
                        </div>
                        {contact.crm_value > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-1">
                            <DollarSign size={12} className="text-green-600" />
                            {contact.crm_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </div>
                        )}
                        {contact.email && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                            <Mail size={12} className="text-slate-400 flex-shrink-0" />
                            <span className="truncate">{contact.email}</span>
                          </div>
                        )}
                        {contact.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Phone size={12} className="text-slate-400 flex-shrink-0" />
                            {contact.phone}
                          </div>
                        )}
                      </div>
                    ))}
                    {stageContacts.length === 0 && (
                      <div className="text-center py-6 text-xs text-slate-400">
                        Arraste contatos aqui
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
