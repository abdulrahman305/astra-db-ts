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

import { Collection, CursorAlreadyInitializedError, DataAPIResponseError, FindCursor } from '@/src/data-api';
import { initTestObjects } from '@/tests/fixtures';
import { DataApiHttpClient } from '@/src/api';
import assert from 'assert';

describe('integration.data-api.cursor', async () => {
  let collection: Collection;
  let httpClient: DataApiHttpClient;

  const add1 = (a: number) => a + 1;

  const sortById = (a: any, b: any) => parseInt(a._id) - parseInt(b._id);
  const sortByAge = (a: any, b: any) => a.age - b.age;

  const ageToString = (doc: { age: number }) => ({ age: `${doc.age}` });

  before(async function () {
    [, , collection] = await initTestObjects(this);
    httpClient = collection['_httpClient'];
  });

  beforeEach(async function () {
    await collection.deleteAll();
  });

  describe('Cursor initialization', () => {
    it('should initialize an uninitialized Cursor', async () => {
      const cursor = new FindCursor<any>('', httpClient, {});
      assert.ok(cursor, 'Cursor should not be nullish');
      assert.strictEqual(cursor.closed, false, 'Cursor should not be closed');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor should not have buffered anything');
      assert.strictEqual(cursor['_state'], 0, 'Cursor is not set to the UNINITIALIZED state');
    });

    it('should contain the proper namespace', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      assert.strictEqual(cursor.namespace, 'test_keyspace', 'Cursor has bad namespace');
    });

    it('should contain the proper options', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, { _id: '1' }, {
        limit: 10,
        skip: 5,
        sort: { _id: 1 },
        projection: { _id: 0 },
        includeSimilarity: true,
      });
      const options = cursor['_options'];
      assert.strictEqual(options.limit, 10, 'Cursor has bad limit');
      assert.strictEqual(options.skip, 5, 'Cursor has bad skip');
      assert.deepStrictEqual(options.sort, { _id: 1 }, 'Cursor has bad sort');
      assert.deepStrictEqual(options.projection, { _id: 0 }, 'Cursor has bad projection');
      assert.strictEqual(options.includeSimilarity, true, 'Cursor has bad includeSimilarity');
      assert.deepStrictEqual(cursor['_filter'], { _id: '1' }, 'Cursor has bad filter');
      assert.strictEqual(cursor['_mapping'], undefined, 'Cursor has bad _mapping');
    });
  });

  describe('Cursor lifecycle manipulation', () => {
    it('Closes cursor', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.close();
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      await collection.insertMany([{ _id: '0', age: '0' }, { _id: '1', age: '1' }, { _id: '2', age: '2' }]);
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [], 'Cursor did not close');
    });

    it('Clones cursor without sharing state', async () => {
      await collection.insertMany([{ _id: '0', age: '0' }, { _id: '1', age: '1' }, { _id: '2', age: '2' }]);
      const cursor = new FindCursor<{ age: number }>('test_keyspace', httpClient, {}, { projection: { _id: 0 } }).sort({ name: 1 }).map(ageToString);
      await cursor.hasNext();
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 3, 'Cursor did not set buffer');
      await cursor.close();

      const clone = cursor.clone();
      assert.deepStrictEqual(clone['_buffer'], [], 'Cursor clone shares _buffer');
      assert.strictEqual(clone.closed, false, 'Cursor clone is closed');
      assert.strictEqual(clone['_state'], 0, 'Cursor clone is not set to the UNINITIALIZED state');
      assert.strictEqual(clone.namespace, 'test_keyspace', 'Cursor clone has bad namespace');
      assert.deepStrictEqual(clone['_options'].projection, { _id: 0 }, 'Cursor clone has bad projection');
      assert.deepStrictEqual(clone['_options'].sort, { name: 1 }, 'Cursor clone has bad sort');
    });

    it('should not copy the mapping function', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      cursor.map(add1);
      const clone = cursor.clone();
      assert.strictEqual(clone['_mapping'], undefined, 'Cursor clone has bad mapping');
    });

    it('should let you build on a cloned cursor', async () => {
      await collection.insertMany([{ _id: '0' }, { _id: '1' }, { _id: '2' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.hasNext();
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 3, 'Cursor did not set buffer');

      await cursor.close();
      assert.throws(() => cursor.filter({ _id: '1' }), CursorAlreadyInitializedError);
      const clone = cursor.clone();
      clone.filter({ _id: '1' });
      assert.deepStrictEqual(clone['_filter'], { _id: '1' }, 'Cursor did not set new filter');
    });

    it('should rewind cursor', async () => {
      await collection.insertMany([{ _id: '0' }, { _id: '1' }, { _id: '2' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.hasNext();
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 3, 'Cursor did not set buffer');

      cursor.rewind();
      assert.strictEqual(cursor['_state'], 0, 'Cursor is not set to the UNINITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not reset buffer');
    });

    it('should allow cloned cursor to re-fetch all data', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.close();
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [], 'Cursor did not close');
      assert.deepStrictEqual(cursor.bufferedCount(), 0, 'Cursor read docs');

      const clone = cursor.clone();
      const res2 = await clone.toArray();
      assert.deepStrictEqual(res2.sort(sortById), docs, 'Cursor did not re-fetch all documents');
    });

    it('should allow cloned cursor with mapping function to re-fetch all data without mapping', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      await cursor.close();
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [], 'Cursor did not close');
      assert.deepStrictEqual(cursor.bufferedCount(), 0, 'Cursor read docs');

      const clone = cursor.clone();
      const res2 = await clone.toArray();
      assert.deepStrictEqual(res2.sort(sortById), docs, 'Cursor did not re-fetch all documents');
    });

    it('should allow rewind-ed cursor to re-fetch all data', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.close();
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [], 'Cursor did not close');
      assert.deepStrictEqual(cursor.bufferedCount(), 0, 'Cursor read docs');

      cursor.rewind();
      const res2 = await cursor.toArray();
      assert.deepStrictEqual(res2.sort(sortById), docs, 'Cursor did not re-fetch all documents');
    });

    it('should allow rewind-ed cursor with mapping function to re-fetch all data with mapping', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      await cursor.close();
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [], 'Cursor did not close');
      assert.deepStrictEqual(cursor.bufferedCount(), 0, 'Cursor read docs');

      cursor.rewind();
      const res2 = await cursor.toArray();
      assert.deepStrictEqual(res2.sort(sortById), docs.map(ageToString), 'Cursor did not re-fetch all documents');
    });
  });

  describe('hasNext() tests', () => {
    it('should test if there are more documents with hasNext()', async () => {
      await collection.insertMany([{ _id: '0' }, { _id: '1' }, { _id: '2' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const next = await cursor.next();
      assert.ok(next, 'Cursor did not read next');
      const hasNext = await cursor.hasNext();
      assert.strictEqual(hasNext, true, 'Cursor did not properly check for more documents');
    });

    it('should test if there are more documents with hasNext() with no buffer set', async () => {
      await collection.insertMany([{ _id: '0' }, { _id: '1' }, { _id: '2' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const hasNext = await cursor.hasNext();
      assert.strictEqual(hasNext, true, 'Cursor did not properly check for more documents');
    });

    it('should test if there are no more documents with hasNext()', async () => {
      await collection.insertMany([{ _id: '0' }, { _id: '1' }, { _id: '2' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      for (let i = 0; i < 3; i++) {
        const doc = await cursor.next();
        assert.ok(doc, `Doc #${i} is null`);
      }
      const hasNext = await cursor.hasNext();
      assert.strictEqual(hasNext, false, 'Cursor did not properly check for more documents');
    });
  });

  describe('readBufferedDocuments() tests', () => {
    it('should read all raw buffered documents', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.hasNext();
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 3, 'Cursor did not set buffer');

      const raw = cursor.readBufferedDocuments();
      assert.strictEqual(raw.length, 3, 'Cursor did not read 3 buffered documents');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.deepStrictEqual(raw.sort(sortById), docs, 'Cursor did not read raw buffered documents');
    });

    it('should read all raw buffered documents with a max', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      await cursor.hasNext();
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 3, 'Cursor did not set buffer');
      cursor['_buffer'] = cursor['_buffer'].sort(sortById); // Only for testing purposes
      const raw = cursor.readBufferedDocuments(2);
      assert.strictEqual(raw.length, 2, 'Cursor did not read 2 buffered documents');
      assert.strictEqual(cursor.bufferedCount(), 1, 'Cursor did not properly consume buffer');
      assert.deepStrictEqual(raw.sort(sortById), docs.slice(0, 2), 'Cursor did not read raw buffered documents');
    });

    it('should read all raw buffered documents even with transformation', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(() => ({ _id: 0 }));
      await cursor.hasNext();
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 3, 'Cursor did not set buffer');

      const raw = cursor.readBufferedDocuments();
      assert.strictEqual(raw.length, 3, 'Cursor did not read 3 buffered documents');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.deepStrictEqual(raw.sort(sortById), docs, 'Cursor did not read raw buffered documents');
    });
  });

  describe('next() tests', () => {
    it('should get next document with next()', async () => {
      await collection.insertMany([{ _id: '0' }, { _id: '1' }, { _id: '2' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const doc = await cursor.next();
      assert.deepStrictEqual(doc, { _id: '0' }, 'Doc is not the first in the collection');
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 2, 'Cursor did properly buffer');
    });

    it('should get 21st document with next()', async () => {
      await collection.insertMany(Array.from({ length: 40 }, (_, i) => ({ _id: `${i}` })));
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});

      let doc: any;
      for (let i = 0; i < 21; i++) {
        doc = await cursor.next();
        if (i !== 20) {
          assert.ok(doc, `Doc #${i} is null`);
        }
      }

      assert.ok(doc, 'Doc is not the 21st in the collection');
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 19, 'Cursor did properly buffer');
    });

    it('should return null if there are no more documents with next()', async () => {
      await collection.insertMany([{ _id: '0' }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const doc = await cursor.next();
      assert.ok(doc, 'Doc is null');
      const next = await cursor.next();
      assert.strictEqual(next, null, 'Cursor did not properly check for more documents');
    });

    it('Provides the next document with a mapping function', async () => {
      await collection.insertMany([{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }]);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      const doc = await cursor.next();
      assert.ok(doc, 'Doc is null');
      assert.ok(typeof doc['age'] === 'string', 'Doc did not map properly');
      assert.strictEqual(cursor['_state'], 1, 'Cursor is not set to the INITIALIZED state');
      assert.strictEqual(cursor.bufferedCount(), 2, 'Cursor did not properly read buffer');
    });
  });

  describe('[Symbol.asyncIterator]() tests', () => {
    it('should iterate over all documents', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      for await (const doc of cursor) {
        res.push(doc);
      }
      assert.deepStrictEqual(res.sort(sortById), docs, 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should iterate over all documents with a mapping function', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      const res: any[] = [];
      for await (const doc of cursor) {
        res.push(doc);
      }
      assert.deepStrictEqual(res.sort(sortById), docs.map(ageToString), 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should iterate over all documents with no documents', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      for await (const doc of cursor) {
        res.push(doc);
      }
      assert.deepStrictEqual(res, [], 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should not iterate when called a second time', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      for await (const doc of cursor) {
        res.push(doc);
      }
      assert.deepStrictEqual(res.sort(sortById), docs, 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
      const res2: any[] = [];
      for await (const doc of cursor) {
        res2.push(doc);
      }
      assert.deepStrictEqual(res2, [], 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
    });

    it('should close cursor after break', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      // noinspection LoopStatementThatDoesntLoopJS
      for await (const doc of cursor) {
        res.push(doc);
        break;
      }
      assert.deepStrictEqual(res, docs.slice(0, 1), 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 2, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });
  });

  describe('toArray() tests', () => {
    it('Gets all documents with toArray()', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res = await cursor.toArray();
      assert.deepStrictEqual(res.sort(sortById), docs, 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('Gets all documents with toArray() with a mapping function', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      const res = await cursor.toArray();
      assert.deepStrictEqual(res.sort(sortById), docs.map(ageToString), 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('Gets all documents with toArray() with no documents', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [], 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should return an empty array when called a second time', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res = await cursor.toArray();
      assert.deepStrictEqual(res.sort(sortById), docs, 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
      const res2 = await cursor.toArray();
      assert.deepStrictEqual(res2, [], 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
    });
  });

  describe('forEach() tests', () => {
    it('should iterate over all documents', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      // noinspection JSDeprecatedSymbols
      await cursor.forEach(doc => { res.push(doc) });
      assert.deepStrictEqual(res.sort(sortById), docs, 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should iterate over all documents with a mapping function', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      const res: any[] = [];
      // noinspection JSDeprecatedSymbols
      await cursor.forEach(doc => { res.push(doc) });
      assert.deepStrictEqual(res.sort(sortById), docs.map(ageToString), 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should iterate over all documents with no documents', async () => {
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      // noinspection JSDeprecatedSymbols
      await cursor.forEach(doc => { res.push(doc) });
      assert.deepStrictEqual(res, [], 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });

    it('should not iterate when called a second time', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      // noinspection JSDeprecatedSymbols
      await cursor.forEach(doc => { res.push(doc) });
      assert.deepStrictEqual(res.sort(sortById), docs, 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 0, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
      const res2: any[] = [];
      // noinspection JSDeprecatedSymbols
      await cursor.forEach(doc => { res.push(doc) });
      assert.deepStrictEqual(res2, [], 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
    });

    it('should close cursor after returning false', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      const res: any[] = [];
      // noinspection JSDeprecatedSymbols
      await cursor.forEach(doc => {
        res.push(doc);
        return false;
      });
      assert.deepStrictEqual(res, docs.slice(0, 1), 'Cursor did not read all documents');
      assert.strictEqual(cursor['_state'], 2, 'Cursor is not set to the CLOSED state');
      assert.strictEqual(cursor.bufferedCount(), 2, 'Cursor did not properly consume buffer');
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });
  });

  describe('filter tests', () => {
    it('should filter documents', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).filter({ _id: '1' });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [docs[1]], 'Cursor did not filter documents');
    });

    it('should filter documents with a mapping function', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).filter({ _id: '1' }).map(ageToString);
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [ageToString(docs[1])], 'Cursor did not filter documents');
    });
  });

  describe('skip/limit tests', () => {
    it('should limit documents', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).limit(2);
      const res = await cursor.toArray();
      assert.deepStrictEqual(res.sort(sortById), docs.slice(0, 2), 'Cursor did not limit documents');
    });

    it('should limit documents across pages', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => ({ _id: `${i}` }));
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).limit(50);
      const res = await cursor.toArray();
      assert.strictEqual(res.length, 50, 'Cursor did not limit documents');
    });

    it('should have no limit if limit is set to 0', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => ({ _id: `${i}` }));
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).limit(0);
      const res = await cursor.toArray();
      assert.strictEqual(res.length, 100, 'Cursor limited documents');
    });

    it('should skip documents', async () => {
      const docs = [{ _id: '0' }, { _id: '1' }, { _id: '2' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).skip(1).sort({ _id: 1 });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res.sort(sortById), docs.slice(1), 'Cursor did not skip documents');
    });

    it('should skip documents across pages', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => ({ _id: i }));
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).skip(50).sort({ _id: 1 });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, docs.slice(50, 70), 'Cursor did not skip documents');
    });

    it('should limit and skip documents across pages', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => ({ _id: i }));
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).skip(50).limit(20).sort({ _id: 1 });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, docs.slice(50, 70), 'Cursor did not limit and skip documents');
    });
  });

  describe('sort tests', () => {
    it('should sort documents', async () => {
      const docs = [{ _id: '2' }, { _id: '0' }, { _id: '1' }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).sort({ _id: 1 });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, docs.sort(sortById), 'Cursor did not sort documents');
    });

    it('should sort documents with a mapping function', async () => {
      const docs = [{ _id: '2', age: 2 }, { _id: '0', age: 0 }, { _id: '1', age: 1 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).sort({ age: 1 }).map(ageToString);
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, docs.sort(sortByAge).map(ageToString), 'Cursor did not sort documents');
    });
  });

  describe('projection tests', () => {
    it('should project documents', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).project({ _id: 0 }).sort({ age: 1 });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [{ age: 0 }, { age: 1 }, { age: 2 }], 'Cursor did not project documents');
    });

    it('should project documents with a mapping function', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).project<{ age: number }>({ _id: 0, age: 1 }).map(ageToString).sort({ age: 1 });
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [{ age: '0' }, { age: '1' }, { age: '2' }], 'Cursor did not project documents');
    });
  });

  describe('mapping tests', () => {
    it('should map documents', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(ageToString);
      const res = await cursor.toArray();
      assert.deepStrictEqual(res, [{ age: '0' }, { age: '1' }, { age: '2' }], 'Cursor did not map documents');
    });

    it('should close cursor and rethrow error if mapping function throws', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {}).map(() => { throw new Error('Mapping error') });
      await assert.rejects(async () => await cursor.toArray(), { message: 'Mapping error' });
      assert.strictEqual(cursor.closed, true, 'Cursor is not closed');
    });
  });

  describe('misc', () => {
    it('should close cursor and rethrow error if getting documents throws', async () => {
      const docs = [{ _id: '0', age: 0 }, { _id: '1', age: 1 }, { _id: '2', age: 2 }];
      await collection.insertMany(docs);
      const cursor = new FindCursor<any>('test_keyspace', httpClient, {});
      cursor['_filter'] = 3 as any;
      await assert.rejects(async () => await cursor.toArray(), DataAPIResponseError);
    });
  })
});
