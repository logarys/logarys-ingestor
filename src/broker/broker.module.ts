import { Global, Module } from '@nestjs/common';
import { NatsJetstreamService } from './services/nats-jetstream.service.js';

@Global()
@Module({
  providers: [NatsJetstreamService],
  exports: [NatsJetstreamService],
})
export class BrokerModule {}
