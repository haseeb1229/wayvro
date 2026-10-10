import { Inject } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection, type OnGatewayDisconnect, type OnGatewayInit } from '@nestjs/websockets';
import { REALTIME_EVENTS, REALTIME_PROTOCOL_VERSION, SessionHelloSchema } from '@wayvro/contracts';
import type { Logger } from '@wayvro/observability';
import type { Server, Socket } from 'socket.io';
import { principalRoom, type ConnectionAuthenticator, type RealtimePrincipal } from './auth.js';
import { CONNECTION_AUTHENTICATOR, LOGGER, REVALIDATE_INTERVAL_MS } from './tokens.js';

interface SocketData {
  principal: RealtimePrincipal;
  timers: NodeJS.Timeout[];
}

/** Longest single setTimeout delay Node accepts. */
const MAX_TIMEOUT_MS = 2_147_483_647;

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(CONNECTION_AUTHENTICATOR) private readonly authenticator: ConnectionAuthenticator,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(REVALIDATE_INTERVAL_MS) private readonly revalidateMs: number,
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
    const data = socket.data as SocketData;
    const { principal } = data;
    await socket.join(principalRoom(principal));
    // The access token's expiry ends the connection; periodic re-validation ends it early on revocation.
    const close = (reason: string) => {
      this.log.info({ reason }, 'realtime connection closed by server');
      socket.disconnect(true);
    };
    data.timers = [
      setTimeout(
        () => {
          close('access-token-expired');
        },
        Math.min(Math.max(0, principal.expiresAt.getTime() - Date.now()), MAX_TIMEOUT_MS),
      ),
      setInterval(() => {
        this.authenticator.isStillValid(principal).then(
          (valid) => {
            if (!valid) close('session-no-longer-valid');
          },
          (e: unknown) => {
            this.log.warn({ err: e }, 'realtime session re-validation failed; closing connection');
            close('revalidation-failed');
          },
        );
      }, this.revalidateMs),
    ];
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

  handleDisconnect(socket: Socket): void {
    for (const t of (socket.data as Partial<SocketData>).timers ?? []) clearTimeout(t);
  }
}
