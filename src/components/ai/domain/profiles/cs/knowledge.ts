import {text} from '../../input.js';
// Product and price are handled by the dedicated products table (ai-data.ts), not free-text here.
// Bidang is folded into Deskripsi rather than kept as its own field.
// Nama/deskripsi/alamat/kontak/jam_operasional merged into one free-text "usaha" field.
// "Lainnya" removed; anything that doesn't fit another field belongs in FAQ as free text.
export const profileFields=['usaha','cara_pemesanan','pembayaran','kebijakan','faq'] as const;
export type ProfileField=typeof profileFields[number];
export const profileLabels:Record<ProfileField,string>={usaha:'Profil usaha',cara_pemesanan:'Cara pemesanan',pembayaran:'Metode pembayaran',kebijakan:'Kebijakan',faq:'FAQ'};
// Only filled-in fields are sent to the agent; empty ones add no noise to the prompt.
export function composeKnowledge(profile:Partial<Record<ProfileField,string>>){
 return profileFields.map(field=>{const value=profile[field]?.trim();return value?profileLabels[field]+': '+value:null;}).filter(Boolean).join('\n\n');
}
