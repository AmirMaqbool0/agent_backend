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
      required: true
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
    googleEventId: {
      type: String,
      default: ''
    },
    calendarStatus: {
      type: String,
      enum: ['pending', 'created', 'deleted', 'failed'],
      default: 'pending'
    },
    confirmationSent: {
      type: Boolean,
      default: false
    },
    whatsappStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },
    whatsappError: {
      type: String,
      default: ''
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
