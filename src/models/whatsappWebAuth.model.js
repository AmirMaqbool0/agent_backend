import mongoose from 'mongoose';

// Baileys credentials and Signal keys must survive Render restarts. Never expose this collection
// through an API: its contents give access to the linked WhatsApp account.
const whatsappWebAuthSchema = new mongoose.Schema({
  _id: String,
  payload: { type: String, required: true }
}, { versionKey: false });

export const WhatsappWebAuth = mongoose.model('WhatsappWebAuth', whatsappWebAuthSchema);
