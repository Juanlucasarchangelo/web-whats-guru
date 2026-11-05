import { isMaster, normalizeRole } from './permissions.js';

// Pure, testable authorization rules. The database query must always include the selected organization.
// Conversation oversight is broader than WhatsApp instance administration.
export const admin = req => isMaster(req) || normalizeRole(req.role) === 'administrador';
export const channelAdmin = req => isMaster(req);
export const ownedChannel = (row, userId) => row.config?.owner_user_id === userId;
export const allowedChannelIds = (req, channels) => channels
  .filter(row => channelAdmin(req) || ownedChannel(row, req.user.id)).map(row => row.id);
export const conversationVisibility = (req, channelIds) => admin(req)
  ? {org_id:req.orgId}
  : {org_id:req.orgId,channel:'whatsapp',integration_id:{in:channelIds}};
