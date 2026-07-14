import mongoose from 'mongoose';

const callLogSchema = new mongoose.Schema(
  {
    callerName: {
      type: String,
      default: ''
    },
    phone: {
      type: String,
      required: true
    },
    patientName: {
      type: String,
      default: ''
    },
    vapiCallId: {
      type: String,
      default: null,
      index: true
    },
    callSid: {
      type: String,
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: [
        'received',
        'queued',
        'ringing',
        'active',
        'booked',
        'cancelled',
        'rescheduled',
        'missed',
        'urgent',
        'transferred',
        'completed',
        'failed'
      ],
      default: 'received'
    },
    assistantId: {
      type: String,
      default: ''
    },
    providerStatus: {
      type: String,
      default: ''
    },
    summary: {
      type: String,
      default: ''
    },
    transcript: {
      type: String,
      default: ''
    },
    transcriptEntries: {
      type: [
        {
          speaker: {
            type: String,
            default: 'unknown'
          },
          text: {
            type: String,
            default: ''
          },
          timestamp: {
            type: mongoose.Schema.Types.Mixed,
            default: null
          }
        }
      ],
      default: []
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null
    },
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative', 'unknown'],
      default: 'unknown'
    },
    durationSeconds: {
      type: Number,
      default: 0
    },
    recordingUrl: {
      type: String,
      default: ''
    },
    lastEventType: {
      type: String,
      default: ''
    },
    receivedEventTypes: {
      type: [String],
      default: []
    },
    bookingOutcome: {
      type: String,
      enum: ['none', 'booked', 'cancelled', 'rescheduled'],
      default: 'none'
    },
    transferOutcome: {
      type: String,
      enum: ['none', 'requested', 'completed', 'failed'],
      default: 'none'
    },
    startedAt: {
      type: Date,
      default: null
    },
    endedAt: {
      type: Date,
      default: null
    },
    endedReason: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

export const CallLog = mongoose.model('CallLog', callLogSchema);
