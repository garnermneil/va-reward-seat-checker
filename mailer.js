const nodemailer = require('nodemailer');
const { renderEmailHtml } = require('./index');

function createMailTransport() {
  const requiredSettings = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'];
  const missingSettings = requiredSettings.filter((setting) => !process.env[setting]);
  if (missingSettings.length > 0) {
    throw new Error(`Missing SMTP settings: ${missingSettings.join(', ')}.`);
  }

  if (process.env.SMTP_USER && !process.env.SMTP_PASSWORD) {
    throw new Error('SMTP_PASSWORD is required when SMTP_USER is set.');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
}

async function sendSummaryEmail(to, summary) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to ?? '')) {
    throw new Error('Enter a valid recipient email address.');
  }

  return createMailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Virgin Atlantic reward-seat summary',
    html: renderEmailHtml(summary),
  });
}

module.exports = { sendSummaryEmail };
