// Copyright DataStax, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { HttpClient } from '@/src/api/http-client';
import { DEFAULT_TIMEOUT, HTTP_METHODS } from '@/src/api/constants';
import { DevopsApiResponseError, DevopsAPITimeout } from '@/src/client/errors';
import { AxiosError, AxiosResponse } from 'axios';
import { InternalHTTPClientOptions } from '@/src/api/types';
import { HTTP1AuthHeaderFactories, HTTP1Strategy } from '@/src/api/http1';

interface DevopsApiRequestInfo {
  path: string,
  timeout?: number,
  method: HTTP_METHODS,
  data?: Record<string, any>,
  params?: Record<string, any>,
}

export class DevopsApiHttpClient extends HttpClient {
  constructor(props: InternalHTTPClientOptions) {
    super(props);
    this.requestStrategy = new HTTP1Strategy(HTTP1AuthHeaderFactories.DevopsApi);
  }

  public async request(info: DevopsApiRequestInfo): Promise<AxiosResponse> {
    try {
      const url = this.baseUrl + info.path;

      return await this._request({
        url: url,
        method: info.method,
        timeout: info.timeout || DEFAULT_TIMEOUT,
        timeoutError: new DevopsAPITimeout(url, info.timeout || DEFAULT_TIMEOUT),
        params: info.params,
        data: info.data,
      }) as any;
    } catch (e) {
      if (!(e instanceof AxiosError)) {
        throw e;
      }
      throw new DevopsApiResponseError(e);
    }
  }
}
