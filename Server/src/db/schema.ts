import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  groqApiKey: text('groq_api_key').notNull(), 
  createdAt: timestamp('created_at').defaultNow(),
});

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalText: text('original_text').notNull(),
  scrubbedText: text('scrubbed_text').notNull(),
  piiMapping: text('pii_mapping').notNull(), 
  status: text('status', { enum: ['uploaded', 'processing', 'completed', 'failed'] }).notNull(),
  contractType: text('contract_type'),
  riskLevel: text('risk_level'),
  selectedModel: text('selected_model'),
  progressStep: text('progress_step').default('Document Uploaded'),
  progressPercent: integer('progress_percent').default(10),
  createdAt: timestamp('created_at').defaultNow(),
});

export const auditResults = pgTable('audit_results', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull(),
  executiveSummary: text('executive_summary').notNull(),
  identifiedRisks: text('identified_risks').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

