import { ImapFlow } from "imapflow";
import { ImapConfig } from "./types";

export class ImapReplyDetector {
  private readonly client: ImapFlow;
  private connected = false;

  constructor(config: ImapConfig) {
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.client.connect();
    await this.client.mailboxOpen("INBOX");
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) {
      return;
    }

    await this.client.logout();
    this.connected = false;
  }

  async hasReplySince(email: string, sentAt: Date): Promise<boolean> {
    const uids = await this.client.search({
      from: email,
      since: sentAt
    });

    if (!uids || uids.length === 0) {
      return false;
    }

    for await (const message of this.client.fetch(uids, {
      envelope: true,
      internalDate: true
    })) {
      const receivedAt = message.envelope?.date ?? message.internalDate;
      const receivedDate =
        receivedAt instanceof Date ? receivedAt : receivedAt ? new Date(receivedAt) : null;

      if (receivedDate && !Number.isNaN(receivedDate.getTime()) && receivedDate.getTime() > sentAt.getTime()) {
        return true;
      }
    }

    return false;
  }
}
