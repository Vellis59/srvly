import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || "welcome@mg.srvly.app";

export async function sendWelcomeEmail(user: {
  name: string | null;
  email: string | null;
}) {
  if (!user.email) return;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#020617;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#020617">
<tr><td style="padding:40px 16px">
<table align="center" width="480" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:16px;border:1px solid #1e293b">
<tr><td style="padding:40px 32px 0;text-align:center">
<span style="font-size:48px">♜</span>
<h1 style="color:#fff;font-size:24px;font-weight:600;margin:16px 0 4px">Welcome to srvly${user.name ? `, ${user.name}` : ""}!</h1>
<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px">Your AI-powered VPS management platform is ready.</p>
</td></tr>
<tr><td style="padding:0 32px">
<a href="https://console.srvly.app/dashboard" style="display:block;text-align:center;background:#34d399;color:#0f172a;padding:14px 24px;border-radius:12px;font-weight:600;font-size:15px;text-decoration:none">Go to Dashboard →</a>
</td></tr>
<tr><td style="padding:24px 32px 32px">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="33%" style="text-align:center;padding:12px 8px">
<div style="font-size:20px;margin-bottom:4px">🖥️</div>
<p style="color:#94a3b8;font-size:12px;margin:0">Add a server</p>
</td>
<td width="33%" style="text-align:center;padding:12px 8px;border-left:1px solid #1e293b;border-right:1px solid #1e293b">
<div style="font-size:20px;margin-bottom:4px">📦</div>
<p style="color:#94a3b8;font-size:12px;margin:0">Deploy 1668+ apps</p>
</td>
<td width="33%" style="text-align:center;padding:12px 8px">
<div style="font-size:20px;margin-bottom:4px">🤖</div>
<p style="color:#94a3b8;font-size:12px;margin:0">Use your AI agent</p>
</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 32px 32px;text-align:center">
<p style="color:#64748b;font-size:12px;margin:0">Need help? <a href="https://docs.srvly.app" style="color:#34d399;text-decoration:none">Read the docs</a></p>
</td></tr>
</table>
<p style="text-align:center;color:#475569;font-size:11px;margin-top:16px">srvly — open source MIT · <a href="https://console.srvly.app/terms" style="color:#475569">Terms</a> · <a href="https://console.srvly.app/privacy" style="color:#475569">Privacy</a></p>
</td></tr>
</table>
</body>
</html>`;

  const text = `Welcome to srvly${user.name ? `, ${user.name}` : ""}!

Your AI-powered VPS management platform is ready.

→ Go to Dashboard: https://console.srvly.app/dashboard

Add a server → Deploy 1668+ apps → Use your AI agent

Need help? https://docs.srvly.app

srvly — open source MIT`;

  try {
    await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: `Welcome to srvly${user.name ? `, ${user.name}` : ""}!`,
      html,
      text,
    });
    console.log(`[email] Welcome email sent to ${user.email}`);
  } catch (err) {
    console.error(`[email] Failed to send welcome to ${user.email}:`, err);
  }
}
