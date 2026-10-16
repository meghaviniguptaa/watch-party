import http from 'node:http';
import { config as defaults } from './config.js';
import { RoomManager } from './core/RoomManager.js';
import { MovieService } from './movies/MovieService.js';
import { createApp } from './http/app.js';
import { attachGateway } from './ws/gateway.js';
import { createDispatcher } from './ws/dispatcher.js';

export function createServer(overrides = {}) {
  const config = { ...defaults, ...overrides };
  const movies = MovieService.fromFile();
  const rooms = new RoomManager(config);
  const httpServer = http.createServer(createApp({ rooms, movies, config }));
  const wss = attachGateway({ httpServer, dispatch: createDispatcher({ rooms, movies }), config });

  return {
    config,
    rooms,
    movies,
    httpServer,
    listen: () =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.port, config.host, () => resolve(httpServer.address()));
      }),
    close: async () => {
      rooms.closeAll();
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}