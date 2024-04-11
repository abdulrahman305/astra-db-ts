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
// noinspection DuplicatedCode

import { Collection, DataAPIResponseError, DataAPITimeoutError, Db } from '@/src/data-api';
import { DEFAULT_COLLECTION_NAME, initTestObjects, OTHER_NAMESPACE } from '@/tests/fixtures';
import { DataAPIHttpClient } from '@/src/api';
import assert from 'assert';

describe('integration.api.data-api-http-client', () => {
  let httpClient: DataAPIHttpClient;
  let collection: Collection;

  before(async function () {
    let db: Db;
    [, db, collection] = await initTestObjects(this);
    httpClient = db['_httpClient'];
  });

  beforeEach(async function () {
    await collection.deleteAll();
  });

  describe('executeCommand tests', () => {
    it('should execute a db-level command', async () => {
      const resp = await httpClient.executeCommand({
        findCollections: {},
      }, {});
      assert.strictEqual(resp.status?.collections.length, 1);
    });

    it('should execute a db-level command in another namespace', async () => {
      const resp = await httpClient.executeCommand({
        findCollections: {},
      }, {
        namespace: OTHER_NAMESPACE,
      });
      assert.strictEqual(resp.status?.collections.length, 1);
    });

    it('should execute a collection-level command', async () => {
      const resp = await httpClient.executeCommand({
        insertOne: { document: { name: 'John' } }
      }, {
        collection: DEFAULT_COLLECTION_NAME,
      });
      assert.ok(resp.status?.insertedIds[0]);
    });

    it('should error on invalid token', async function () {
      const [client] = await initTestObjects(this);
      const httpClient = client.db(process.env.ASTRA_URI!, { token: 'invalid-token' })['_httpClient'];

      try {
        await httpClient.executeCommand({ findCollections: {} }, {});
        assert.fail('Expected error');
      } catch (e) {
        assert.ok(e instanceof DataAPIResponseError);
        assert.strictEqual(e.errorDescriptors.length, 1);
        assert.strictEqual(e.detailedErrorDescriptors.length, 1);
        assert.strictEqual(e.errorDescriptors[0].message, 'Authentication failed; is your token valid?');
      }
    });

    it('should timeout properly', async () => {
      await assert.rejects(async () => {
        await httpClient.executeCommand({
          findCollections: {},
        }, {
          namespace: OTHER_NAMESPACE,
          maxTimeMS: 1,
        });
      }, DataAPITimeoutError);
    });

    // it('should throw DataAPIHttpError on non-2XX responses', async function () {
    //   try {
    //     const [client] = await initTestObjects(this, false);
    //     const httpClient = client.db('https://f1183f15-dc85-4fbf-8aae-f1ca97338bbb-us-east-1.apps.astra.datastax.com', { token: 'invalid-token' })['_httpClient'];
    //     await httpClient.executeCommand({
    //       findCollections: {},
    //     }, {});
    //   } catch (e) {
    //     console.log(e);
    //     assert.ok(e instanceof DataAPIHttpError);
    //     assert.strictEqual(e.status, 502);
    //     assert.ok(typeof e.body === 'string');
    //     assert.strictEqual(e.raw.httpVersion, 1);
    //   }
    // });
  });
});
