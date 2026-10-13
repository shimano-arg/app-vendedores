import 'server-only';
import nodemailer from 'nodemailer';

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;

const transporter =
  user && pass
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      })
    : null;

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!transporter || !user) {
    return { ok: false, error: 'GMAIL_USER / GMAIL_APP_PASSWORD not set' };
  }
  try {
    const info = await transporter.sendMail({
      from: user,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
