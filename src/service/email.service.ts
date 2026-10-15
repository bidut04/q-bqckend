import { BrevoClient } from "@getbrevo/brevo";
import { env } from "../config/env";
import { AppError } from "../../utils/app-error";

export interface SendOtpEmailOptions {
  toEmail: string;
  otp: string;
  recipientName?: string;
  purpose?: string; // e.g. "Account Verification", "Login", "Password Reset"
  expiryMinutes?: number;
}

export class BrevoEmailService {
  private getSenderEmail(): string {
    return (process.env.BREVO_SENDER_EMAIL || env.BREVO_SENDER_EMAIL || "").trim();
  }

  private getSenderName(): string {
    return (process.env.BREVO_SENDER_NAME || env.BREVO_SENDER_NAME || "ePaper Verification").trim();
  }

  private getClient(): BrevoClient | null {
    const key = (process.env.BREVO_API_KEY || env.BREVO_API_KEY || "").trim();
    if (!key) return null;
    return new BrevoClient({ apiKey: key });
  }

  /**
   * Generates a modern, clean HTML template for the OTP email
   */
  private buildOtpTemplate(otp: string, purpose: string, expiryMinutes: number): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${purpose} - Your Verification Code</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f6f8;
      margin: 0;
      padding: 24px;
      color: #1e293b;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      padding: 28px 24px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 32px 28px;
      text-align: center;
    }
    .intro {
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
    }
    .otp-box {
      background-color: #f8fafc;
      border: 2px dashed #cbd5e1;
      border-radius: 10px;
      padding: 20px 16px;
      margin: 24px 0;
    }
    .otp-code {
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #1e293b;
      font-family: monospace;
      margin: 0;
    }
    .expiry {
      font-size: 13px;
      color: #64748b;
      margin-top: 8px;
    }
    .warning {
      font-size: 13px;
      color: #dc2626;
      background-color: #fef2f2;
      border-radius: 8px;
      padding: 12px;
      margin: 24px 0 16px 0;
      text-align: left;
    }
    .footer {
      background-color: #f8fafc;
      padding: 18px 24px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ePaper System</h1>
    </div>
    <div class="content">
      <p class="intro">
        Hello,<br/>
        Use the one-time verification code below for <strong>${purpose}</strong>:
      </p>
      
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
        <div class="expiry">Expires in <strong>${expiryMinutes} minutes</strong></div>
      </div>

      <div class="warning">
        🔒 <strong>Security Notice:</strong> Never share this OTP with anyone. Our staff will never ask for your code. If you did not request this code, you can safely ignore this email.
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} ePaper. All rights reserved.
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Send OTP Email via Brevo Transactional Email API
   */
  public async sendOtpEmail(options: SendOtpEmailOptions): Promise<{ success: boolean; messageId?: string }> {
    const { toEmail, otp, recipientName, purpose = "Verification", expiryMinutes = 5 } = options;

    const client = this.getClient();
    const senderEmail = this.getSenderEmail();
    const senderName = this.getSenderName();

    // Local development fallback when BREVO_API_KEY is not configured
    if (!client) {
      console.log("=================================================");
      console.log("📨 [DEV EMAIL SANDBOX] BREVO_API_KEY not configured");
      console.log(`To: ${toEmail}`);
      console.log(`Purpose: ${purpose}`);
      console.log(`🔐 OTP CODE: ${otp} (Valid for ${expiryMinutes}m)`);
      console.log("Set BREVO_API_KEY in .env to deliver real emails.");
      console.log("=================================================");
      return { success: true, messageId: "dev-sandbox-mode" };
    }

    try {
      const htmlContent = this.buildOtpTemplate(otp, purpose, expiryMinutes);
      const subject = `${otp} is your ${purpose} verification code`;

      const response = await client.transactionalEmails.sendTransacEmail({
        sender: {
          email: senderEmail,
          name: senderName,
        },
        to: [
          {
            email: toEmail,
            name: recipientName || toEmail,
          },
        ],
        subject,
        htmlContent,
      });

      const messageId = (response as any)?.messageId || "sent";
      console.log(`✅ [Brevo] OTP Email delivered to ${toEmail} (ID: ${messageId})`);
      return { success: true, messageId };
    } catch (error: any) {
      console.error("❌ [Brevo] Failed to send email via Brevo:", error?.message || error);
      throw new AppError(
        `Failed to send verification email: ${error?.message || "Brevo provider error"}`,
        502,
        "EMAIL_DELIVERY_FAILED"
      );
    }
  }

  /**
   * Send Generic / Status Notification Email via Brevo API
   */
  public async sendNotificationEmail(options: {
    toEmail: string;
    recipientName?: string;
    subject: string;
    title: string;
    messageHtml: string;
  }): Promise<{ success: boolean; messageId?: string }> {
    const { toEmail, recipientName, subject, title, messageHtml } = options;
    const client = this.getClient();
    const senderEmail = this.getSenderEmail();
    const senderName = this.getSenderName();

    if (!client) {
      console.log("=================================================");
      console.log("📨 [DEV EMAIL SANDBOX] BREVO_API_KEY not configured");
      console.log(`To: ${toEmail} (${recipientName || "Admin"})`);
      console.log(`Subject: ${subject}`);
      console.log("=================================================");
      return { success: true, messageId: "dev-sandbox-mode" };
    }

    try {
      const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f6f8; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #0ea5e9, #0284c7); padding: 28px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .footer { background-color: #f8fafc; padding: 18px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
    </div>
    <div class="content">
      ${messageHtml}
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} ePaper QueueFlow. All rights reserved.
    </div>
  </div>
</body>
</html>
      `.trim();

      const response = await client.transactionalEmails.sendTransacEmail({
        sender: {
          email: senderEmail,
          name: senderName,
        },
        to: [
          {
            email: toEmail,
            name: recipientName || toEmail,
          },
        ],
        subject,
        htmlContent,
      });

      const messageId = (response as any)?.messageId || "sent";
      console.log(`✅ [Brevo] Notification Email delivered to ${toEmail} (ID: ${messageId})`);
      return { success: true, messageId };
    } catch (error: any) {
      console.error("❌ [Brevo] Failed to send email via Brevo:", error?.message || error);
      throw new AppError(
        `Failed to send notification email: ${error?.message || "Brevo provider error"}`,
        502,
        "EMAIL_DELIVERY_FAILED"
      );
    }
  }
}

export const emailService = new BrevoEmailService();
