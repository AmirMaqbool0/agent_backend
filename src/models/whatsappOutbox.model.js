import mongoose from 'mongoose';

const whatsappOutboxSchema = new mongoose.Schema({
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
  kind: { type: String, enum: ['confirmation', 'reschedule', 'cancellation'], required: true },
  appointmentDate: { type: Date, required: true },
  phone: { type: String, required: true },
  body: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  attempts: { type: Number, default: 0 },
  messageId: { type: String, default: '' },
  error: { type: String, default: '' }
}, { timestamps: true });

export const WhatsappOutbox = mongoose.model('WhatsappOutbox', whatsappOutboxSchema);
