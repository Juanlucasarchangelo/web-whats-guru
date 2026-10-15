/** Pure safeguards shared by campaign and schedule workers. */
export const validPhone=phone=>/^\d{10,15}$/.test(String(phone||'').replace(/\D/g,''));
export const hasMarketingConsent=contact=>contact?.custom_fields?.whatsapp_marketing_opt_in===true;
export const campaignLimit=limit=>Math.min(Math.max(1,Number(limit)||1),30);
export function hasAllTags(tagIds,selectedIds){return selectedIds.every(id=>tagIds.includes(id));}
