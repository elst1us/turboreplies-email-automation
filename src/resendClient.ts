import { Resend } from "resend";
import { EmailContent, ResendConfig } from "./types";

export class ResendClient {
  private readonly resend: Resend;

  constructor(private readonly config: ResendConfig) {
    this.resend = new Resend(config.apiKey);
  }

  async sendEmail(to: string, content: EmailContent): Promise<string> {
    const response = await this.resend.emails.send({
      from: `${this.config.fromName} <${this.config.fromEmail}>`,
      to,
      replyTo: this.config.replyTo,
      subject: content.subject,
      text: content.text,
      html: content.html
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.data?.id ?? "unknown";
  }
}
