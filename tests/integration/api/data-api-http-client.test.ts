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

import { Collection, DataAPIResponseError, DataAPITimeout, Db } from '@/src/data-api';
import { DEFAULT_COLLECTION_NAME, initTestObjects, OTHER_NAMESPACE } from '@/tests/fixtures';
import { DataApiHttpClient } from '@/src/api';
import assert from 'assert';

describe('integration.api.data-api-http-client', () => {
  let httpClient: DataApiHttpClient;
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
      });
      assert.strictEqual(resp.status?.collections.length, 1);
    });

    it('should execute a db-level command in another namespace', async () => {
      const resp = await httpClient.executeCommand({
        findCollections: {},
      }, {
        namespace: OTHER_NAMESPACE,
      });
      assert.strictEqual(resp.status?.collections.length, 0);
    });

    it('should execute a collection-level command', async () => {
      const resp = await httpClient.executeCommand({
        insertOne: { document: { name: 'John' } }
      }, {
        collection: DEFAULT_COLLECTION_NAME,
      });
      assert.ok(resp.status?.insertedIds[0]);
    });

    it('should error on invalid token', async () => {
      const clonedClient = httpClient.cloneInto(DataApiHttpClient, (c) => {
        c.applicationToken = 'invalid';
      });

      try {
        await clonedClient.executeCommand({ findCollections: {} });
        assert.fail('Expected error');
      } catch (e) {
        assert.ok(e instanceof DataAPIResponseError);
        assert.strictEqual(e.errorDescriptors.length, 1);
        assert.strictEqual(e.detailedErrorDescriptors.length, 1);
        assert.strictEqual(e.errorDescriptors[0].message, 'Authentication failed; is your token valid?');
      }
    });

    it('should error when underlying strategy is closed', async function () {
      const [, db] = await initTestObjects(this);
      const localClient = db['_httpClient'];

      try {
        localClient.close();
        await localClient.executeCommand({ findCollections: function () {} });
        assert.fail('Expected error');
      } catch (e) {
        assert.ok(e instanceof Error);
        assert.strictEqual(e.message, 'Cannot make http2 request when client is closed');
      }
    });

    it('should not mutate original command when cleaning up skipped options', async () => {
      const clonedClient = httpClient.cloneInto(DataApiHttpClient, (c) => {
        c.logSkippedOptions = true;
      });

      const command = {
        insertOne: {
          document: { name: 'John' },
          options: { skip: 1 },
        }
      };

      const commandClone = structuredClone(command);
      await clonedClient.executeCommand(command, { collection: DEFAULT_COLLECTION_NAME }, new Set());

      assert.deepStrictEqual(command, commandClone);
    });

    it('should not mutate original command when "cleaning up" non-existent options', async () => {
      const clonedClient = httpClient.cloneInto(DataApiHttpClient, (c) => {
        c.logSkippedOptions = true;
      });

      const command = {
        insertOne: {
          document: { name: 'John' },
        }
      };

      const commandClone = structuredClone(command);
      await clonedClient.executeCommand(command, { collection: DEFAULT_COLLECTION_NAME }, new Set());

      assert.deepStrictEqual(command, commandClone);
    });

    it('should timeout properly', async () => {
      await assert.rejects(async () => {
        await httpClient.executeCommand({
          findCollections: {},
        }, {
          namespace: OTHER_NAMESPACE,
          maxTimeMS: 1,
        });
      }, DataAPITimeout);
    });
  });
});
