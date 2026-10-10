import { Inject } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection, type OnGatewayInit } from '@nestjs/websockets';
import { REALTIME_EVENTS, REALTIME_PROTOCOL_VERSION, SessionHelloSchema } from '@wayvro/contracts';
import type { Logger } from '@wayvro/observability';
import type { Server, Socket } from 'socket.io';
import { principalRoom, type ConnectionAuthenticator, type RealtimePrincipal } from './auth.js';
import { CONNECTION_AUTHENTICATOR, LOGGER } from './tokens.js';

interface SocketData {
  principal: RealtimePrincipal;
}

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(CONNECTION_AUTHENTICATOR) private readonly authenticator: ConnectionAuthenticator,
    @Inject(LOGGER) private readonly log: Logger,
  ) {}

  afterInit(server: Server): void {
    // Authenticate before the connection is accepted (fail closed on any error).
    server.use((socket: Socket, next) => {
      this.authenticator
        .authenticate({ auth: socket.handshake.auth, headers: socket.handshake.headers })
        .then((principal) => {
          if (!principal) {
            next(new Error('WAYVRO_E_UNAUTHENTICATED'));
            return;
          }
          (socket.data as SocketData).principal = principal;
          next();
        })
        .catch((e: unknown) => {
          this.log.warn({ err: e }, 'realtime authenticator failed; connection refused');
          next(new Error('WAYVRO_E_UNAUTHENTICATED'));
        });
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { principal } = socket.data as SocketData;
    await socket.join(principalRoom(principal));
    // Realtime is a delivery channel only: tell the client to (re)load authoritative state over HTTP (ADR-005b).
    socket.emit(
      REALTIME_EVENTS.sessionHello,
      SessionHelloSchema.parse({
        type: 'session.hello',
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        serverTime: new Date().toISOString(),
        resync: 'fetch-snapshot',
      }),
    );
  }
}
