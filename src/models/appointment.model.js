import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true
    },
    appointmentDate: {
      type: Date,
      required: true,
      index: true
    },
    durationMinutes: {
      type: Number,
      default: 30
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'confirmed'
    },
    cancelledAt: {
      type: Date,
      default: null
    },
    cancelledBy: {
      type: String,
      default: ''
    },
    cancellationReason: {
      type: String,
      default: ''
    },
    source: {
      type: String,
      enum: ['phone', 'dashboard', 'whatsapp'],
      default: 'phone'
    },
    reason: {
      type: String,
      default: ''
    },
    notes: {
      type: String,
      default: ''
    },
    googleEventId: {
      type: String,
      default: ''
    },
    calendarStatus: {
      type: String,
      enum: ['pending', 'created', 'deleted', 'failed', 'disabled'],
      default: 'pending'
    },
    confirmationSent: {
      type: Boolean,
      default: false
    },
    whatsappStatus: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped'],
      default: 'pending'
    },
    whatsappError: {
      type: String,
      default: ''
    },
    whatsappMessageSid: {
      type: String,
      default: '',
      index: true
    },
    notificationStatus: {
      whatsapp: {
        sent: {
          type: Boolean,
          default: false
        },
        error: {
          type: String,
          default: ''
        },
        attemptedAt: {
          type: Date,
          default: null
        }
      }
    },
    notificationLogs: {
      type: [
        {
          channel: {
            type: String,
            enum: ['whatsapp', 'sms'],
            default: 'whatsapp'
          },
          status: {
            type: String,
            enum: ['sent', 'failed', 'skipped'],
            default: 'failed'
          },
          reason: {
            type: String,
            default: ''
          },
          sid: {
            type: String,
            default: ''
          },
          // Template (Content SID) used for this message; empty for free-form text.
          template: {
            type: String,
            default: ''
          },
          // Free-form text kept so a failed template message can be retried once as plain text.
          fallbackBody: {
            type: String,
            default: ''
          },
          fallbackSent: {
            type: Boolean,
            default: false
          },
          createdAt: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: []
    }
  },
  {
    timestamps: true
  }
);

export const Appointment = mongoose.model('Appointment', appointmentSchema);
