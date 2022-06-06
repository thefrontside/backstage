/*
 * Copyright 2022 The Frontside Software, Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Config } from '@backstage/config';
import { errorHandler, PluginEndpointDiscovery } from '@backstage/backend-common';
import express from 'express';
import Router from 'express-promise-router';
import { Logger } from 'winston';
import { createHumanitecClient } from '../clients/humanitec';
import { fetchAppInfo } from '../clients/fetch-app-info';

export interface RouterOptions {
  logger: Logger;
  config: Config;
  discovery: PluginEndpointDiscovery
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, config, discovery } = options;
  const proxyPath = config.getOptionalString('humanitec.proxyPath') ?? '/humanitec';
  const api = `${await discovery.getBaseUrl('proxy')}${proxyPath}`;

  const router = Router();
  router.use(express.json());

  router.get('/health', (_, response) => {
    logger.info('PONG!');
    response.send({ status: 'ok' });
  });

  router.get('/environments', async (request, response) => {

    // Mandatory headers and http status to keep connection open
    response.writeHead(200, {
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
    });

    // eslint-disable-next-line prefer-const
    let { appId, orgId } = request.query as { appId: string; orgId: string };

    if (!orgId) {
      orgId = config.getString('humanitec.orgId');
    }

    const client = createHumanitecClient({ api, orgId });

    let timeout: NodeJS.Timeout;

    function scheduleUpdate(interval: number) {
      async function update() {
        const result = await fetchAppInfo({ client }, appId);
        const data = JSON.stringify(result);
        response.write(`data: ${data}\n\n`);
        flush(response);
      }
      update()
        .then(() => {
          timeout = setTimeout(() => scheduleUpdate(interval), interval);
        })
        .catch((e) => {
          logger.error(`Error encountered trying to update environment`);
          logger.debug(e);
          response.end();
        })
    }

    request.on('close', () => clearTimeout(timeout));

    scheduleUpdate(1000);

  });

  router.use(errorHandler());
  return router;
}

function flush(response: express.Response) {
  const flushable = response as unknown as { flush: Function };
  if (typeof flushable.flush === 'function') {
    flushable.flush();
  }
}