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

import { DEFAULT_COLLECTION_NAME, initTestObjects } from '@/tests/fixtures';
import { DataApiClient } from '@/src/client';
import { Collection, Db } from '@/src/data-api';
import assert from 'assert';
import process from 'process';

describe('integration.misc.hierarchy-traversal tests', () => {
  let client: DataApiClient;
  let db: Db;
  let collection: Collection;

  const endpoint = process.env.ASTRA_URI!;

  const idAndRegion = endpoint.split('.')[0].split('https://')[1].split('-');
  const id = idAndRegion.slice(0, 5).join('-');
  const region = idAndRegion.slice(5).join('-');

  before(async function () {
    [client, db, collection] = await initTestObjects(this);
  });

  beforeEach(async function () {
    await collection.deleteAll();
  });

  describe('db->admin->db', () => {
    it('is a noop', () => {
      const db1 = db.admin().db();
      const db2 = db.admin().db().admin().db();
      assert.strictEqual(db, db1);
      assert.strictEqual(db, db2);
    });

    it('works with endpoint', async () => {
      const collections = await db.listCollections();
      assert.ok(Array.isArray(collections));

      const db1 = db.admin().db();
      const collections1 = await db1.listCollections();
      assert.ok(Array.isArray(collections1));

      const db2 = db.admin().db().admin().db();
      const collections2 = await db2.listCollections();
      assert.ok(Array.isArray(collections2));

      assert.deepStrictEqual(collections, collections1);
      assert.deepStrictEqual(collections, collections2);

      assert.doesNotThrow(async () => await db1.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
      assert.doesNotThrow(async () => await db2.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
    });
  });

  describe('client->admin->dbAdmin <-> client->db->admin', () => {
    it('is essentially a noop', () => {
      const dbAdmin1 = client.admin().dbAdmin(endpoint);
      const dbAdmin2 = client.db(endpoint).admin();
      assert.strictEqual(dbAdmin1.db().id, dbAdmin2.db().id);
      assert.strictEqual(dbAdmin1.db().namespace, dbAdmin2.db().namespace);
    });

    it('works with endpoint', async () => {
      const dbAdmin1 = client.admin().dbAdmin(endpoint);
      const dbAdmin2 = client.db(endpoint).admin();
      const info1 = await dbAdmin1.info();
      const info2 = await dbAdmin2.info();
      assert.deepStrictEqual(info1.info.name, info2.info.name);
      assert.deepStrictEqual(info1.id, info2.id);
    });

    it('works with endpoint & id + region', async () => {
      const dbAdmin1 = client.admin().dbAdmin(endpoint);
      const dbAdmin2 = client.db(id, region).admin();
      const info1 = await dbAdmin1.info();
      const info2 = await dbAdmin2.info();
      assert.deepStrictEqual(info1.info.name, info2.info.name);
      assert.deepStrictEqual(info1.id, info2.id);
    });

    it('works with id + region & endpoint', async () => {
      const dbAdmin1 = client.admin().dbAdmin(id, region);
      const dbAdmin2 = client.db(endpoint).admin();
      const info1 = await dbAdmin1.info();
      const info2 = await dbAdmin2.info();
      assert.deepStrictEqual(info1.info.name, info2.info.name);
      assert.deepStrictEqual(info1.id, info2.id);
    });
  });

  describe('client->admin->dbAdmin->db <-> client->db->admin->db', () => {
    it('is essentially a noop', async () => {
      const db1 = client.admin().dbAdmin(endpoint).db();
      const db2 = client.db(endpoint).admin().db();
      assert.strictEqual(db1.id, db2.id);
      assert.strictEqual(db1.namespace, db2.namespace);

      assert.doesNotThrow(async () => await db1.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
      assert.doesNotThrow(async () => await db1.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
    });

    it('works with endpoint', async () => {
      const db1 = client.admin().dbAdmin(endpoint).db();
      const collections1 = await db1.listCollections();
      assert.ok(Array.isArray(collections1));

      const db2 = client.db(endpoint).admin().db();
      const collections2 = await db2.listCollections();
      assert.ok(Array.isArray(collections2));

      assert.deepStrictEqual(collections1, collections2);

      assert.doesNotThrow(async () => await db1.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
      assert.doesNotThrow(async () => await db2.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
    });

    it('works with endpoint & id + region', async () => {
      const db1 = client.admin().dbAdmin(endpoint).db();
      const collections1 = await db1.listCollections();
      assert.ok(Array.isArray(collections1));

      const db2 = client.db(id, region).admin().db();
      const collections2 = await db2.listCollections();
      assert.ok(Array.isArray(collections2));

      assert.deepStrictEqual(collections1, collections2);

      assert.doesNotThrow(async () => await db1.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
      assert.doesNotThrow(async () => await db2.collection(DEFAULT_COLLECTION_NAME).insertOne({ name: 'test' }));
    });

    it('works with id + region & endpoint', async () => {
      const db1 = client.admin().dbAdmin(id, region).db();
      const collections1 = await db1.listCollections();
      assert.ok(Array.isArray(collections1));

      const db2 = client.db(endpoint).admin().db();
      const collections2 = await db2.listCollections();
      assert.ok(Array.isArray(collections2));

      assert.deepStrictEqual(collections1, collections2);
    });
  });
});
