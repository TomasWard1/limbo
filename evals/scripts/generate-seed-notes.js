#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const NOTES_DIR = path.join(__dirname, '..', 'vault-seed', 'notes');

const topics = [
  { id: 'persona-carlos-ward', title: 'Carlos Ward', type: 'person', desc: 'Father of Tomas, engineer living in Cordoba', content: 'Carlos Ward is an engineer living in Córdoba. Father of Tomas.' },
  { id: 'persona-maria-lopez', title: 'Maria Lopez', type: 'person', desc: 'Family friend, works in education', content: 'Maria Lopez is a family friend who works in education in Buenos Aires.' },
  { id: 'persona-lucas-tech', title: 'Lucas from tech meetup', type: 'person', desc: 'Met at a tech meetup, works at MercadoLibre', content: 'Lucas works at MercadoLibre as a backend engineer. Met him at a Buenos Aires tech meetup.' },
  { id: 'project-limbo-memory-agent', title: 'Limbo project', type: 'project', desc: 'Personal AI memory agent project', content: 'Limbo is a personal AI memory agent that captures ideas and connects knowledge.' },
  { id: 'project-knok-alerts', title: 'Knok alerts app', type: 'project', desc: 'macOS alert system for AI agents', content: 'Knok is a macOS app that displays alerts from AI agents on the desktop.' },
  { id: 'decision-use-postgres', title: 'Use PostgreSQL', type: 'decision', desc: 'Chose PostgreSQL over MongoDB for new project', content: 'Decided to use PostgreSQL instead of MongoDB. Better for relational queries and joins.' },
  { id: 'idea-whatsapp-agent', title: 'WhatsApp messaging for agents', type: 'idea', desc: 'AI agents communicating via WhatsApp API', content: 'Idea: let AI agents send and receive WhatsApp messages for notifications and commands.' },
  { id: 'fact-alergia-mani', title: 'Peanut allergy', type: 'fact', desc: 'Tomas is allergic to peanuts', content: 'Tomas has a peanut allergy. Must avoid all peanut products.' },
  { id: 'fact-timezone-argentina', title: 'Timezone', type: 'fact', desc: 'Tomas lives in America/Buenos_Aires timezone (GMT-3)', content: 'Timezone: America/Buenos_Aires (GMT-3).' },
  { id: 'preference-asado-sundays', title: 'Sunday asado', type: 'preference', desc: 'Tomas prefers asado on Sundays', content: 'Tomas loves doing asado on Sundays with family and friends.' },
  { id: 'event-dentist-march', title: 'Dentist appointment', type: 'event', desc: 'Dentist appointment scheduled for March 27', content: 'Dentist appointment on March 27 at 10am.' },
  { id: 'source-designing-data-intensive', title: 'DDIA book', type: 'source', desc: 'Designing Data-Intensive Applications by Martin Kleppmann', content: 'Reading Designing Data-Intensive Applications by Martin Kleppmann. Great reference for distributed systems.' },
  { id: 'insight-eval-tool-calling', title: 'Tool calling compliance', type: 'insight', desc: 'Sonnet confirms actions without executing tool calls', content: 'Sonnet 4.6 sometimes confirms vault operations without actually calling the tools. Opus is more compliant.' },
  { id: 'question-kubernetes-scale', title: 'Is Kubernetes worth it', type: 'question', desc: 'Should we migrate to Kubernetes at our current scale?', content: 'Open question: is Kubernetes worth the complexity at our current scale of 3 services?' },
  { id: 'persona-sofia-globant', title: 'Sofia from Globant', type: 'person', desc: 'Data scientist at Globant, friend from high school', content: 'Sofia works at Globant as a data scientist. Known since high school.' },
];

// Generate base topic notes
let count = 0;
for (const topic of topics) {
  const frontmatter = [
    '---',
    `id: ${topic.id}`,
    `title: "${topic.title}"`,
    `description: "${topic.desc}"`,
    `type: ${topic.type}`,
    `schema_version: 1`,
    `created: "2026-01-15"`,
    '---',
  ].join('\n');

  const filePath = path.join(NOTES_DIR, `${topic.id}.md`);
  fs.writeFileSync(filePath, `${frontmatter}\n\n${topic.content}\n`);
  count++;
}

// Generate more variants to reach ~50
const variants = [
  'meeting', 'follow-up', 'research', 'update', 'review',
  'brainstorm', 'analysis', 'comparison', 'draft', 'summary',
];
const domains = ['tech', 'personal', 'work', 'health', 'finance'];

for (let i = 0; i < 35; i++) {
  const variant = variants[i % variants.length];
  const domain = domains[i % domains.length];
  const id = `${variant}-${domain}-${String(i).padStart(3, '0')}`;
  const title = `${variant.charAt(0).toUpperCase() + variant.slice(1)} on ${domain} topic ${i}`;
  const type = ['fact', 'insight', 'idea', 'project', 'source'][i % 5];

  const frontmatter = [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    `description: "A ${variant} note about ${domain} matters number ${i}"`,
    `type: ${type}`,
    `schema_version: 1`,
    `created: "2026-02-${String((i % 28) + 1).padStart(2, '0')}"`,
    '---',
  ].join('\n');

  const content = `This is a ${variant} note about ${domain} topic number ${i}. It contains various details and references that make it searchable across the vault.`;
  const filePath = path.join(NOTES_DIR, `${id}.md`);
  fs.writeFileSync(filePath, `${frontmatter}\n\n${content}\n`);
  count++;
}

console.log(`Generated ${count} seed notes in ${NOTES_DIR}`);
