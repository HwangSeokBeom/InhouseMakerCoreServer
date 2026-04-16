import { Injectable } from '@nestjs/common';

interface DeliverNotificationInput {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  payload: unknown;
}

@Injectable()
export class NoopNotificationDeliveryProvider {
  async deliver(_input: DeliverNotificationInput): Promise<void> {
    // External push delivery is intentionally deferred. The provider boundary keeps
    // queue processing stable while allowing APNs/FCM integration later.
  }
}
